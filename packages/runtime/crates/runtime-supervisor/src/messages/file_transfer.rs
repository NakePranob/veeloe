//! `file.chunk` and `file.get`: attachments in and files out of a Task.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use veeloe_protocol::base64url::to_base64url;

use crate::tasks::{agent_of, Inbound, Machine, Outbox};
use crate::uploads::UploadError;

/// One chunk of an upload, held until a `task.message` names it.
pub(crate) fn chunk(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let Some(uploads) = machine.uploads else {
        return outbox.error(from, "attachment.unavailable");
    };
    let (Some(file), Some(index), Some(total), Some(data)) = (
        body.get("file").and_then(Value::as_str),
        body.get("index").and_then(Value::as_u64),
        body.get("total").and_then(Value::as_u64),
        body.get("data").and_then(Value::as_str),
    ) else {
        return outbox.error(from, "attachment.invalid");
    };
    let Ok(bytes) = veeloe_protocol::base64url::from_base64url(data) else {
        return outbox.error(from, "attachment.invalid");
    };
    match uploads.add(file, index as usize, total as usize, &bytes) {
        Ok(_) => {}
        Err(UploadError::TooLarge) => outbox.error(from, "attachment.too_large"),
        Err(_) => outbox.error(from, "attachment.invalid"),
    }
}

/// A file in the Agent's Workdir, sent back in chunks.
pub(crate) fn get(machine: &Machine<'_>, outbox: &dyn Outbox, from: &Inbound, body: &Value) {
    let registry = machine.registry;
    let Ok(Some(agent)) = registry.get(agent_of(body)) else {
        return outbox.error(from, "agent.unknown");
    };
    // A file of an Agent's Workdir is for those who may use it (ADR 0059).
    if machine
        .trust
        .is_some_and(|trust| !trust.uses(&agent.id, &from.member, from.key.as_deref()))
    {
        return outbox.error(from, "agent.forbidden");
    }
    let Some(task) = from.task.as_deref() else {
        return outbox.error(from, "task.unknown");
    };
    let (Some(path), Some(hash)) = (
        body.get("path").and_then(Value::as_str),
        body.get("hash").and_then(Value::as_str),
    ) else {
        return outbox.error(from, "attachment.invalid");
    };
    let Ok(workdir) = crate::agents::agent_dir(registry.home(), &agent.id) else {
        return outbox.error(from, "agent.unavailable");
    };
    let Ok(real) = std::fs::canonicalize(path) else {
        return outbox.error(from, "attachment.missing");
    };
    // The path the Agent offered is already real; resolve the folder too, or a
    // symlinked home (`/var` on macOS) would fail a prefix that is really inside it.
    let Ok(root) = std::fs::canonicalize(workdir.join("workdir")) else {
        return outbox.error(from, "agent.unavailable");
    };
    if !real.starts_with(root) {
        return outbox.error(from, "attachment.invalid");
    }
    let Ok(bytes) = std::fs::read(&real) else {
        return outbox.error(from, "attachment.missing");
    };
    if to_base64url(&Sha256::digest(&bytes)) != hash {
        return outbox.error(from, "attachment.invalid");
    }
    let name = real
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();
    let Some(chunk) = crate::direct::download_chunk(bytes.len()) else {
        return send_direct(outbox, from, task, hash, &name, &bytes);
    };
    let total = std::cmp::max(1, bytes.len().div_ceil(chunk));
    for index in 0..total {
        let start = index * chunk;
        let end = std::cmp::min(start + chunk, bytes.len());
        outbox.to_member(
            &from.member,
            "file.chunk",
            json!({
                "file": hash,
                "name": name,
                "index": index,
                "total": total,
                "data": veeloe_protocol::base64url::to_base64url(&bytes[start..end]),
            }),
            Some(task),
        );
    }
}

/// A big file, on the asking device's own direct link only. Without one the
/// Controller hears `file.needs_direct` and asks again once it has one.
fn send_direct(
    outbox: &dyn Outbox,
    from: &Inbound,
    task: &str,
    hash: &str,
    name: &str,
    bytes: &[u8],
) {
    let Some(key) = from.key.as_deref() else {
        return outbox.error(from, "file.needs_direct");
    };
    let total = bytes.len().div_ceil(crate::direct::DIRECT_CHUNK_BYTES);
    for index in 0..total {
        let start = index * crate::direct::DIRECT_CHUNK_BYTES;
        let end = std::cmp::min(start + crate::direct::DIRECT_CHUNK_BYTES, bytes.len());
        let sent = outbox.to_device_direct(
            key,
            &from.member,
            "file.chunk",
            json!({
                "file": hash,
                "name": name,
                "index": index,
                "total": total,
                "data": to_base64url(&bytes[start..end]),
            }),
            Some(task),
        );
        if !sent {
            return outbox.error(from, "file.needs_direct");
        }
    }
}
