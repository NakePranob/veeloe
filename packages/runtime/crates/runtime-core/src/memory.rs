//! `MEMORY.md` at the Workdir root (ADR 0036): the Agent edits it with the
//! normal file tools, and the Runtime pins a capped copy into every new Turn.

use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Temp names are unique per process and call, so two writers never share one.
static TEMP: AtomicU64 = AtomicU64::new(0);

/// Thai uses more characters than English for the same thought; this is a
/// character cap, not a token count, so every Provider reads it the same.
pub const MEMORY_LIMIT: usize = 4_000;

const TRUNCATED: &str = "\n\n(Memory is over the 4,000 character cap. Keep only what every Task needs.)";

/// What `MEMORY.md` holds, read once: the whole file's size and the capped text
/// the prompt gets. `exists` tells an absent file apart from an empty one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memory {
    pub exists: bool,
    pub chars: usize,
    pub text: String,
}

/// Read `MEMORY.md` from a Workdir. A missing or unreadable file is an absent
/// Memory with no text, never an error: the prompt and the read-only views
/// (`veeloe memory`, `memory.get`) must agree on what the next Turn sees.
pub fn read_memory(workdir: &Path) -> Memory {
    // Read through the *resolved* path and refuse one that leaves the Workdir: a
    // symlink made by a sandboxed command would otherwise carry any file the user
    // can read (provider keys included) into the prompt and the Memory page.
    let Some(path) = readable_path(workdir, Path::new(MEMORY_FILE)) else {
        return Memory {
            exists: false,
            chars: 0,
            text: String::new(),
        };
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Memory {
            exists: false,
            chars: 0,
            text: String::new(),
        };
    };
    let chars = text.chars().count();
    let mut all = text.chars();
    let capped: String = all.by_ref().take(MEMORY_LIMIT).collect();
    let text = if all.next().is_some() {
        format!("{capped}{TRUNCATED}")
    } else {
        capped
    };
    Memory {
        exists: true,
        chars,
        text,
    }
}

/// `<workdir>/<relative>` only when its real path stays inside the Workdir; a
/// missing file is `None`, and so is a symlink that leaves it.
fn readable_path(workdir: &Path, relative: &Path) -> Option<PathBuf> {
    let root = fs::canonicalize(workdir).ok()?;
    let real = fs::canonicalize(root.join(relative)).ok()?;
    real.starts_with(&root).then_some(real)
}

/// The file Memory lives in, at the Workdir root (ADR 0036).
pub const MEMORY_FILE: &str = "MEMORY.md";

/// How a write meets what is already there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Add to the end, separated by a blank line.
    Append,
    /// Replace the whole file.
    Replace,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MemoryWriteError {
    #[error("memory.too_long: {chars} characters, the cap is {MEMORY_LIMIT}; shorten it and try again")]
    TooLong { chars: usize },
    #[error("memory.bad: {0}")]
    Bad(String),
    #[error("memory.io: {0}")]
    Io(String),
}

impl From<std::io::Error> for MemoryWriteError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

/// Write `MEMORY.md` under the cap, atomically. The tool and the pre-compaction
/// flush both come through here, so the cap and the file layout have one owner.
pub fn write_memory(workdir: &Path, text: &str, mode: Mode) -> Result<usize, MemoryWriteError> {
    let body = text.trim();
    if body.is_empty() {
        return Err(MemoryWriteError::Bad("nothing to write".into()));
    }
    let path = safe_path(workdir, Path::new(MEMORY_FILE))?;
    let next = match mode {
        Mode::Replace => body.to_string(),
        Mode::Append => match fs::read_to_string(&path) {
            Ok(existing) if !existing.trim().is_empty() => {
                format!("{}\n\n{}", existing.trim_end(), body)
            }
            _ => body.to_string(),
        },
    };
    let chars = next.chars().count();
    if chars > MEMORY_LIMIT {
        return Err(MemoryWriteError::TooLong { chars });
    }
    write_atomic(&path, &next)?;
    Ok(chars)
}

/// `<workdir>/memory/<date>.md`, where the Agent keeps what is not for every Task.
pub fn daily_note_path(workdir: &Path, date: &str) -> PathBuf {
    workdir.join("memory").join(format!("{date}.md"))
}

/// Append to a day's note, creating `memory/` when it is missing. Daily notes are
/// not capped like `MEMORY.md`: they are the scratch layer, not the pinned one.
pub fn append_daily_note(workdir: &Path, date: &str, text: &str) -> Result<usize, MemoryWriteError> {
    if date.len() != 10
        || !date.bytes().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
    {
        return Err(MemoryWriteError::Bad(format!("not a day: {date}")));
    }
    let body = text.trim();
    if body.is_empty() {
        return Err(MemoryWriteError::Bad("nothing to write".into()));
    }
    let path = safe_path(workdir, &Path::new("memory").join(format!("{date}.md")))?;
    let next = match fs::read_to_string(&path) {
        Ok(existing) if !existing.trim().is_empty() => {
            format!("{}\n\n{}", existing.trim_end(), body)
        }
        _ => body.to_string(),
    };
    let chars = next.chars().count();
    write_atomic(&path, &next)?;
    Ok(chars)
}

/// The target inside `workdir`, after resolving symlinks: a link that points out
/// of the Workdir is refused, as the file tools refuse it (ADR 0032). The parent
/// is created first so its own real path can be checked.
fn safe_path(workdir: &Path, relative: &Path) -> Result<PathBuf, MemoryWriteError> {
    let root = fs::canonicalize(workdir)?;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let dir = root.join(parent);
    fs::create_dir_all(&dir)?;
    let real_dir = fs::canonicalize(&dir)?;
    if !real_dir.starts_with(&root) {
        return Err(MemoryWriteError::Bad(
            "path is outside the working folder".into(),
        ));
    }
    let Some(name) = relative.file_name() else {
        return Err(MemoryWriteError::Bad("no file name".into()));
    };
    let target = real_dir.join(name);
    if target.exists() {
        let real = fs::canonicalize(&target)?;
        if !real.starts_with(&root) {
            return Err(MemoryWriteError::Bad(
                "path is outside the working folder".into(),
            ));
        }
        return Ok(real);
    }
    Ok(target)
}

/// Write beside the target, flush, then rename: a crash leaves the old file whole.
fn write_atomic(path: &Path, text: &str) -> Result<(), MemoryWriteError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("memory");
    let temp = path.with_file_name(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let write = || -> Result<(), MemoryWriteError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        Ok(())
    };
    if let Err(error) = write() {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

/// The Memory prompt for a Workdir, or empty when the file is absent.
pub fn memory_prompt(workdir: &Path) -> String {
    read_memory(workdir).text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn a_memory_file_is_read_and_capped() {
        let dir = tempdir().expect("dir");
        fs::write(dir.path().join("MEMORY.md"), "a".repeat(MEMORY_LIMIT + 10)).expect("write");
        let memory = read_memory(dir.path());
        assert!(memory.exists);
        assert_eq!(memory.chars, MEMORY_LIMIT + 10);
        assert!(memory.text.starts_with(&"a".repeat(MEMORY_LIMIT)));
        assert!(memory.text.ends_with(TRUNCATED));
    }

    #[test]
    fn a_memory_at_the_cap_has_no_notice() {
        let dir = tempdir().expect("dir");
        fs::write(dir.path().join("MEMORY.md"), "a".repeat(MEMORY_LIMIT)).expect("write");
        let memory = read_memory(dir.path());
        assert_eq!(memory.chars, MEMORY_LIMIT);
        assert_eq!(memory.text, "a".repeat(MEMORY_LIMIT));
    }

    #[test]
    fn an_empty_file_is_a_memory_with_no_text() {
        let dir = tempdir().expect("dir");
        fs::write(dir.path().join("MEMORY.md"), "").expect("write");
        let memory = read_memory(dir.path());
        assert!(memory.exists);
        assert_eq!(memory.chars, 0);
        assert_eq!(memory.text, "");
    }

    #[test]
    fn an_append_keeps_the_old_text_and_a_replace_drops_it() {
        let dir = tempdir().expect("dir");
        assert_eq!(write_memory(dir.path(), "owner likes tea", Mode::Append).expect("append"), 15);
        assert_eq!(
            write_memory(dir.path(), "answers in Thai", Mode::Append).expect("append"),
            15 + 2 + 15
        );
        assert_eq!(
            fs::read_to_string(dir.path().join(MEMORY_FILE)).expect("read"),
            "owner likes tea\n\nanswers in Thai"
        );
        write_memory(dir.path(), "just tea", Mode::Replace).expect("replace");
        assert_eq!(
            fs::read_to_string(dir.path().join(MEMORY_FILE)).expect("read"),
            "just tea"
        );
    }

    #[test]
    fn a_write_that_would_pass_the_cap_is_refused_and_changes_nothing() {
        let dir = tempdir().expect("dir");
        write_memory(dir.path(), "kept", Mode::Append).expect("append");
        let error = write_memory(dir.path(), &"a".repeat(MEMORY_LIMIT), Mode::Append).expect_err("too long");
        assert_eq!(
            error,
            MemoryWriteError::TooLong {
                chars: 4 + 2 + MEMORY_LIMIT
            }
        );
        assert_eq!(
            fs::read_to_string(dir.path().join(MEMORY_FILE)).expect("read"),
            "kept"
        );
    }

    #[test]
    fn a_daily_note_is_its_own_file_and_has_no_cap() {
        let dir = tempdir().expect("dir");
        assert_eq!(append_daily_note(dir.path(), "2026-11-12", "first").expect("note"), 5);
        append_daily_note(dir.path(), "2026-11-12", "second").expect("note");
        assert_eq!(
            fs::read_to_string(daily_note_path(dir.path(), "2026-11-12")).expect("read"),
            "first\n\nsecond"
        );
        assert!(!dir.path().join(MEMORY_FILE).exists());
        assert_eq!(
            append_daily_note(dir.path(), "12 November", "x"),
            Err(MemoryWriteError::Bad("not a day: 12 November".into()))
        );
    }

    #[test]
    fn a_day_with_slashes_is_not_a_day() {
        let dir = tempdir().expect("dir");
        assert_eq!(
            append_daily_note(dir.path(), "2026/11/12", "x"),
            Err(MemoryWriteError::Bad("not a day: 2026/11/12".into()))
        );
    }

    #[test]
    fn a_memory_symlink_that_leaves_the_workdir_reads_as_absent() {
        let home = tempdir().expect("home");
        let outside = tempdir().expect("outside");
        fs::write(outside.path().join("secret.txt"), "top secret").expect("outside");
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            home.path().join(MEMORY_FILE),
        )
        .expect("link");

        let memory = read_memory(home.path());
        assert!(!memory.exists);
        assert_eq!(memory.text, "");
        assert_eq!(memory_prompt(home.path()), "");
    }

    #[test]
    fn a_memory_symlink_that_stays_inside_still_reads() {
        let home = tempdir().expect("home");
        fs::write(home.path().join("notes.md"), "owner likes tea").expect("notes");
        std::os::unix::fs::symlink(home.path().join("notes.md"), home.path().join(MEMORY_FILE))
            .expect("link");

        let memory = read_memory(home.path());
        assert!(memory.exists);
        assert_eq!(memory.text, "owner likes tea");
    }

    #[test]
    fn a_symlink_that_leaves_the_workdir_is_refused() {
        let home = tempdir().expect("home");
        let outside = tempdir().expect("outside");
        fs::write(outside.path().join("MEMORY.md"), "not yours").expect("outside");
        std::os::unix::fs::symlink(
            outside.path().join("MEMORY.md"),
            home.path().join(MEMORY_FILE),
        )
        .expect("link");

        let error = write_memory(home.path(), "x", Mode::Append).expect_err("refused");
        assert!(matches!(error, MemoryWriteError::Bad(_)), "{error}");
        assert_eq!(
            fs::read_to_string(outside.path().join("MEMORY.md")).expect("read"),
            "not yours"
        );
    }

    #[test]
    fn a_memory_folder_that_leaves_the_workdir_is_refused() {
        let home = tempdir().expect("home");
        let outside = tempdir().expect("outside");
        std::os::unix::fs::symlink(outside.path(), home.path().join("memory")).expect("link");

        let error = append_daily_note(home.path(), "2026-11-12", "x").expect_err("refused");
        assert!(matches!(error, MemoryWriteError::Bad(_)), "{error}");
        assert!(!outside.path().join("2026-11-12.md").exists());
    }

    #[test]
    fn no_file_is_an_empty_memory() {
        let dir = tempdir().expect("dir");
        assert_eq!(read_memory(dir.path()), Memory { exists: false, chars: 0, text: String::new() });
        assert_eq!(memory_prompt(dir.path()), "");
    }
}
