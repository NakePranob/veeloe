//! Small JSON files the Runtime keeps: read whole, written atomically and
//! owner-only, so a half-written file never reads as "nothing".

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum JsonFileError {
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Broken(String),
}

/// The file's JSON, or None when it does not exist. A file that cannot be read
/// or parsed is an error, never an empty answer.
pub fn read_json_file(path: &Path) -> Result<Option<Value>, JsonFileError> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| JsonFileError::Broken(format!("cannot read {}: {error}", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(JsonFileError::Broken(format!(
            "cannot read {}: {error}",
            path.display()
        ))),
    }
}

pub fn write_json_file(path: &Path, value: &Value) -> Result<(), JsonFileError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| JsonFileError::Io(error.to_string()))?;
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| JsonFileError::Broken(error.to_string()))?;
    write_atomic(path, &text, 0o600)
}

/// Writes through a temporary file and renames it, so a reader sees the old
/// file or the new one and never half of either.
pub fn write_atomic(path: &Path, text: &str, mode: u32) -> Result<(), JsonFileError> {
    write_atomic_bytes(path, text.as_bytes(), mode)
}

pub fn write_atomic_bytes(path: &Path, bytes: &[u8], mode: u32) -> Result<(), JsonFileError> {
    static TEMPORARY: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temporary: PathBuf = path.with_file_name(format!(
        ".{name}.tmp-{stamp}-{}",
        TEMPORARY.fetch_add(1, Ordering::SeqCst)
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary)?;
        file.set_permissions(fs::Permissions::from_mode(mode))?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| JsonFileError::Io(error.to_string()))
}
