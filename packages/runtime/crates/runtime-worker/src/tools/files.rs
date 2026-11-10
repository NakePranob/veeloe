//! The file tools, ported from `packages/runtime-legacy/src/worker/adapters/files.ts`.
//!
//! Every path is resolved to its real target and refused when that target is
//! outside the Workdir, so a symlink cannot carry a read or a write out of the
//! sandbox. The read-only runner has `read`, `glob` and `grep` only.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use regex::RegexBuilder;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;
use veeloe_plugin_api::{Cancel, ToolDefinition, ToolError, ToolRunner};

pub const READ_MAX_LINES: usize = 2_000;
pub const READ_MAX_BYTES: usize = 256 * 1024;
pub const READ_MAX_FILE: u64 = 10 * 1024 * 1024;
pub const WRITE_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const GLOB_MAX: usize = 200;
pub const GREP_MAX: usize = 200;
pub const GREP_MAX_FILE: u64 = 1024 * 1024;
pub const PATTERN_MAX: usize = 500;

const SKIPPED: [&str; 2] = [".git", "node_modules"];
const READ_DESCRIPTION: &str = "Reads a file from your working folder and returns it with line numbers (line<TAB>text).
Use offset (first line, 1-based) and limit (how many lines, default 2000) for a large file. A file over 2000 lines or 256KB comes back cut, with the number of lines left.";
const WRITE_DESCRIPTION: &str =
    "Writes a file in your working folder, replacing it whole and creating its folders. Up to 2MB.";
const EDIT_DESCRIPTION: &str = "Replaces old_string with new_string in one file. old_string must appear exactly once, unless replace_all is true. Nothing is written when it appears zero or many times.";
const GLOB_DESCRIPTION: &str = "Finds files in your working folder by a glob pattern such as src/**/*.ts. Returns relative paths, at most 200, skipping .git and node_modules.";
const GREP_DESCRIPTION: &str = "Searches files in your working folder with a regular expression and returns path:line: text, at most 200 lines. include is a glob such as src/**/*.ts; files over 1MB and binary files are skipped.";

pub struct FileTools {
    workdir: PathBuf,
    read_only: bool,
}

impl FileTools {
    pub fn new(workdir: impl AsRef<Path>, read_only: bool) -> Self {
        Self {
            workdir: workdir.as_ref().to_path_buf(),
            read_only,
        }
    }

    fn build_definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions = vec![
            ToolDefinition {
                name: "read".into(),
                description: READ_DESCRIPTION.into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "A path inside your working folder, relative or absolute." },
                        "offset": { "type": "number", "description": "First line to return, 1-based. Default 1." },
                        "limit": { "type": "number", "description": format!("How many lines to return. Default and maximum {READ_MAX_LINES}.") },
                    },
                    "required": ["path"],
                }),
            },
            ToolDefinition {
                name: "glob".into(),
                description: GLOB_DESCRIPTION.into(),
                input_schema: json!({
                    "type": "object",
                    "properties": { "pattern": { "type": "string", "description": "A glob pattern, for example src/**/*.ts." } },
                    "required": ["pattern"],
                }),
            },
            ToolDefinition {
                name: "grep".into(),
                description: GREP_DESCRIPTION.into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "A regular expression." },
                        "include": { "type": "string", "description": "Which files to search, as a glob. Default **/*." },
                        "ignore_case": { "type": "boolean", "description": "Match without regard to case." },
                    },
                    "required": ["pattern"],
                }),
            },
        ];
        if !self.read_only {
            definitions.push(ToolDefinition {
                name: "write".into(),
                description: WRITE_DESCRIPTION.into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "A path inside your working folder." },
                        "content": { "type": "string", "description": "The whole new content of the file." },
                    },
                    "required": ["path", "content"],
                }),
            });
            definitions.push(ToolDefinition {
                name: "edit".into(),
                description: EDIT_DESCRIPTION.into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "A path inside your working folder." },
                        "old_string": { "type": "string", "description": "The exact text to replace." },
                        "new_string": { "type": "string", "description": "The text to put in its place." },
                        "replace_all": { "type": "boolean", "description": "Replace every occurrence instead of exactly one." },
                    },
                    "required": ["path", "old_string", "new_string"],
                }),
            });
        }
        definitions.push(ToolDefinition {
            name: "send_file".into(),
            description: "Offers a file from your working folder to the Member as an attachment. Use this for reports, screenshots, or other files they should open. The file must already exist.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "A file inside your working folder." } },
                "required": ["path"],
            }),
        });
        definitions
    }
}

#[async_trait]
impl ToolRunner for FileTools {
    fn definitions(&self) -> Vec<ToolDefinition> {
        self.build_definitions()
    }

    async fn run(&self, name: &str, input: &Value, _cancel: &Cancel) -> Result<String, ToolError> {
        let record = input.as_object().cloned().unwrap_or_default();
        match name {
            "read" => read(&self.workdir, &record),
            "glob" => glob(&self.workdir, &record),
            "grep" => grep(&self.workdir, &record),
            "write" if !self.read_only => write(&self.workdir, &record),
            "edit" if !self.read_only => edit(&self.workdir, &record),
            "send_file" => send_file(&self.workdir, &record),
            other => Err(ToolError::Unknown(other.into())),
        }
    }
}

fn send_file(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let path = text(input, "path")?;
    let real = resolve_in_workdir(workdir, &path)?;
    let bytes = fs::read(&real).map_err(|error| ToolError::Failed(error.to_string()))?;
    let name = real.file_name().and_then(|name| name.to_str()).unwrap_or("file");
    Ok(json!({
        "name": name,
        "size": bytes.len(),
        "hash": veeloe_protocol::base64url::to_base64url(&Sha256::digest(&bytes)),
        "path": real.display().to_string(),
    }).to_string())
}

fn text(input: &serde_json::Map<String, Value>, name: &str) -> Result<String, ToolError> {
    match input.get(name).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(value.to_string()),
        _ => Err(ToolError::Failed(format!("{name} is required"))),
    }
}

/// The real path of an existing file or folder, and never one outside the
/// working folder.
pub fn resolve_in_workdir(workdir: &Path, input: &str) -> Result<PathBuf, ToolError> {
    let target = inside_path(workdir, input)?;
    let real = fs::canonicalize(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ToolError::Failed(format!("no such file: {input}"))
        } else {
            ToolError::Failed(error.to_string())
        }
    })?;
    if !inside(workdir, &real) {
        return Err(ToolError::Failed(format!(
            "path is outside the working folder: {input}"
        )));
    }
    Ok(real)
}

/// Where a write may land: a path inside the working folder, with every
/// existing part resolved.
fn resolve_for_write(workdir: &Path, input: &str) -> Result<PathBuf, ToolError> {
    let target = inside_path(workdir, input)?;
    // An existing target is written through its real path, so a symlink inside
    // the folder keeps pointing at its file.
    if target.exists() {
        let real = fs::canonicalize(&target)
            .map_err(|error| ToolError::Failed(error.to_string()))?;
        if !inside(workdir, &real) {
            return Err(ToolError::Failed(format!(
                "path is outside the working folder: {input}"
            )));
        }
        return Ok(real);
    }
    let real_ancestor = fs::canonicalize(existing_ancestor(&target)?)
        .map_err(|error| ToolError::Failed(error.to_string()))?;
    if !inside(workdir, &real_ancestor) {
        return Err(ToolError::Failed(format!(
            "path is outside the working folder: {input}"
        )));
    }
    Ok(target)
}

fn inside_path(workdir: &Path, input: &str) -> Result<PathBuf, ToolError> {
    let root = fs::canonicalize(workdir).map_err(|error| ToolError::Failed(error.to_string()))?;
    let raw = input.trim();
    let candidate = Path::new(raw);
    let target = if candidate.is_absolute() {
        normalise(candidate)
    } else {
        normalise(&root.join(candidate))
    };
    if !within(&root, &target) {
        return Err(ToolError::Failed(format!(
            "path is outside the working folder: {input}"
        )));
    }
    Ok(target)
}

fn inside(workdir: &Path, candidate: &Path) -> bool {
    match fs::canonicalize(workdir) {
        Ok(root) => within(&root, candidate),
        Err(_) => false,
    }
}

/// Lexical containment, so a path that does not exist yet can still be checked.
fn within(root: &Path, candidate: &Path) -> bool {
    let mut rest = candidate.components();
    for part in root.components() {
        if rest.next() != Some(part) {
            return false;
        }
    }
    true
}

/// Resolves `.` and `..` without touching the filesystem, so `../x` is caught
/// before anything is opened.
fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn existing_ancestor(target: &Path) -> Result<PathBuf, ToolError> {
    let mut dir = target.to_path_buf();
    loop {
        if dir.exists() {
            return Ok(dir);
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => {
                return Err(ToolError::Failed(format!(
                    "no such folder: {}",
                    target.display()
                )))
            }
        }
    }
}

/// True only for a path whose real target is inside; a file that vanished
/// mid-scan is skipped.
fn real_inside(root: &Path, file: &Path) -> bool {
    fs::canonicalize(file)
        .map(|real| within(root, &real))
        .unwrap_or(false)
}

fn read(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let file = resolve_in_workdir(workdir, &text(input, "path")?)?;
    let stat = fs::metadata(&file).map_err(|error| ToolError::Failed(error.to_string()))?;
    if !stat.is_file() {
        return Err(ToolError::Failed(format!(
            "not a file: {}",
            input.get("path").and_then(Value::as_str).unwrap_or_default()
        )));
    }
    if stat.len() > READ_MAX_FILE {
        return Err(ToolError::Failed(format!(
            "file is larger than {}MB; use grep or bash to inspect it",
            READ_MAX_FILE / 1024 / 1024
        )));
    }
    let mut raw = Vec::new();
    File::open(&file)
        .and_then(|mut file| file.read_to_end(&mut raw))
        .map_err(|error| ToolError::Failed(error.to_string()))?;
    if raw.iter().take(8_192).any(|byte| *byte == 0) {
        return Err(ToolError::Failed(format!(
            "binary file: {}",
            input.get("path").and_then(Value::as_str).unwrap_or_default()
        )));
    }

    let content = String::from_utf8_lossy(&raw).to_string();
    let lines: Vec<&str> = content.split('\n').collect();
    let start = input
        .get("offset")
        .and_then(Value::as_u64)
        .filter(|offset| *offset > 0)
        .unwrap_or(1) as usize;
    let asked = input
        .get("limit")
        .and_then(Value::as_u64)
        .filter(|limit| *limit > 0)
        .map(|limit| (limit as usize).min(READ_MAX_LINES))
        .unwrap_or(READ_MAX_LINES);
    let chosen: Vec<&str> = lines
        .iter()
        .skip(start - 1)
        .take(asked)
        .copied()
        .collect();

    let mut shown: Vec<String> = Vec::new();
    let mut bytes = 0usize;
    for (index, line) in chosen.iter().enumerate() {
        let rendered = format!("{}\t{line}", start + index);
        let size = rendered.len() + if shown.is_empty() { 0 } else { 1 };
        if bytes + size > READ_MAX_BYTES {
            break;
        }
        shown.push(rendered);
        bytes += size;
    }
    let left = lines
        .len()
        .saturating_sub(start - 1 + shown.len());
    let cut_by_bytes = shown.len() < chosen.len();
    // Say what is left when a cap cut the answer, not when the caller asked for
    // a short slice.
    if left > 0 && (asked >= READ_MAX_LINES || cut_by_bytes) {
        return Ok(format!(
            "{}\n[truncated: {left} more lines; continue with offset {}]",
            shown.join("\n"),
            start + shown.len()
        ));
    }
    Ok(shown.join("\n"))
}

fn write(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let target = resolve_for_write(workdir, &text(input, "path")?)?;
    let content = input
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::Failed("content is required".into()))?;
    if content.len() > WRITE_MAX_BYTES {
        return Err(ToolError::Failed(format!(
            "content is larger than {}MB",
            WRITE_MAX_BYTES / 1024 / 1024
        )));
    }
    if target.is_dir() {
        return Err(ToolError::Failed(format!(
            "not a file: {}",
            input.get("path").and_then(Value::as_str).unwrap_or_default()
        )));
    }
    let mode = if target.exists() {
        fs::metadata(&target)
            .map(|stat| stat.permissions().mode() & 0o777)
            .unwrap_or(0o600)
    } else {
        0o600
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| ToolError::Failed(error.to_string()))?;
    }
    write_atomic(&target, content, mode)?;
    Ok(format!(
        "Wrote {} bytes to {}",
        content.len(),
        relative(workdir, &target)
    ))
}

fn edit(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let file = resolve_in_workdir(workdir, &text(input, "path")?)?;
    let old_string = text(input, "old_string")?;
    let new_string = input
        .get("new_string")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::Failed("new_string is required".into()))?;
    let stat = fs::metadata(&file).map_err(|error| ToolError::Failed(error.to_string()))?;
    if stat.len() > WRITE_MAX_BYTES as u64 {
        return Err(ToolError::Failed(format!(
            "file is larger than {}MB; use write or bash for it",
            WRITE_MAX_BYTES / 1024 / 1024
        )));
    }
    let content = fs::read_to_string(&file).map_err(|error| ToolError::Failed(error.to_string()))?;

    let count = content.matches(&old_string).count();
    if count == 0 {
        return Err(ToolError::Failed("old_string was found 0 times".into()));
    }
    let replace_all = input
        .get("replace_all")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if count > 1 && !replace_all {
        return Err(ToolError::Failed(format!(
            "old_string was found {count} times; make it unique or set replace_all"
        )));
    }
    let next = if replace_all {
        content.replace(&old_string, new_string)
    } else {
        content.replacen(&old_string, new_string, 1)
    };
    if next.len() > WRITE_MAX_BYTES {
        return Err(ToolError::Failed(format!(
            "edited file would be larger than {}MB",
            WRITE_MAX_BYTES / 1024 / 1024
        )));
    }
    let replaced = if replace_all { count } else { 1 };
    write_atomic(&file, &next, stat.permissions().mode() & 0o777)?;
    Ok(format!(
        "Edited {}: replaced {replaced} occurrence{}",
        relative(workdir, &file),
        if replaced == 1 { "" } else { "s" }
    ))
}

fn glob(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let pattern = pattern_of(input, "pattern")?;
    let root = fs::canonicalize(workdir).map_err(|error| ToolError::Failed(error.to_string()))?;
    let matcher = matcher(&pattern)?;
    let mut found: Vec<String> = Vec::new();
    for entry in walk(&root) {
        let entry = entry.as_path();
        let relative = entry
            .strip_prefix(&root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if relative.is_empty() || !matcher.is_match(&relative) {
            continue;
        }
        if !real_inside(&root, entry) {
            continue;
        }
        found.push(relative);
        if found.len() > GLOB_MAX {
            break;
        }
    }
    if found.is_empty() {
        return Ok("no files matched".into());
    }
    found.sort();
    let more = found.len() > GLOB_MAX;
    let shown: Vec<String> = found.into_iter().take(GLOB_MAX).collect();
    let mut answer = shown.join("\n");
    if more {
        answer.push_str(&format!("\n[more files match; showing the first {GLOB_MAX}]"));
    }
    Ok(answer)
}

fn grep(workdir: &Path, input: &serde_json::Map<String, Value>) -> Result<String, ToolError> {
    let source = text(input, "pattern")?;
    if source.len() > PATTERN_MAX {
        return Err(ToolError::Failed(format!(
            "pattern is longer than {PATTERN_MAX} characters"
        )));
    }
    let ignore_case = input
        .get("ignore_case")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let regex = RegexBuilder::new(&source)
        .case_insensitive(ignore_case)
        .build()
        .map_err(|_| ToolError::Failed(format!("invalid regular expression: {source}")))?;
    let include = match input.get("include").and_then(Value::as_str) {
        Some(_) => pattern_of(input, "include")?,
        None => "**/*".to_string(),
    };
    let root = fs::canonicalize(workdir).map_err(|error| ToolError::Failed(error.to_string()))?;
    let matcher = matcher(&include)
        .map_err(|_| ToolError::Failed(format!("invalid include pattern: {include}")))?;

    let mut matches: Vec<String> = Vec::new();
    for entry in walk(&root) {
        let entry = entry.as_path();
        let relative = entry
            .strip_prefix(&root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if relative.is_empty() || !matcher.is_match(&relative) {
            continue;
        }
        // The walker does not follow symlinks today, but grep reads whole files:
        // never let one point outside.
        if !real_inside(&root, entry) {
            continue;
        }
        let Ok(stat) = fs::metadata(entry) else {
            continue;
        };
        if stat.len() > GREP_MAX_FILE {
            continue;
        }
        let Ok(bytes) = fs::read(entry) else {
            continue;
        };
        if bytes.iter().take(8_192).any(|byte| *byte == 0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes).to_string();
        for (index, line) in content.split('\n').enumerate() {
            if !regex.is_match(line) {
                continue;
            }
            matches.push(format!("{relative}:{}: {line}", index + 1));
            if matches.len() >= GREP_MAX {
                return Ok(matches.join("\n")
                    + &format!("\n[more matches; showing the first {GREP_MAX}]"));
            }
        }
    }
    if matches.is_empty() {
        return Ok("no matches".into());
    }
    Ok(matches.join("\n"))
}

fn matcher(pattern: &str) -> Result<globset::GlobMatcher, ToolError> {
    globset::Glob::new(pattern)
        .map(|glob| glob.compile_matcher())
        .map_err(|_| ToolError::Failed(format!("invalid glob pattern: {pattern}")))
}

/// Every file under the root, skipping `.git` and `node_modules`.
fn walk(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !SKIPPED.contains(&name.as_ref())
        })
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .collect()
}

fn pattern_of(
    input: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<String, ToolError> {
    let pattern = text(input, name)?;
    let path = Path::new(&pattern);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ToolError::Failed(format!(
            "{name} must stay inside the working folder: {pattern}"
        )));
    }
    Ok(pattern)
}

fn relative(workdir: &Path, file: &Path) -> String {
    let root = fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    file.strip_prefix(&root)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| file.to_string_lossy().to_string())
}

static TEMPORARY: AtomicU64 = AtomicU64::new(0);

fn write_atomic(file: &Path, content: &str, mode: u32) -> Result<(), ToolError> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let count = TEMPORARY.fetch_add(1, Ordering::SeqCst);
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temporary = file.with_file_name(format!(".{name}.tmp-{stamp}-{count}"));
    let result = (|| -> std::io::Result<()> {
        let mut handle = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary)?;
        handle.set_permissions(fs::Permissions::from_mode(mode))?;
        handle.write_all(content.as_bytes())?;
        handle.sync_all()?;
        fs::rename(&temporary, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| ToolError::Failed(error.to_string()))
}
