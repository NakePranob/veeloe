//! `MEMORY.md` at the Workdir root (ADR 0036): the Agent edits it with the
//! normal file tools, and the Runtime pins a capped copy into every new Turn.

use std::fs;
use std::path::Path;

/// Thai uses more characters than English for the same thought; this is a
/// character cap, not a token count, so every Provider reads it the same.
pub const MEMORY_LIMIT: usize = 4_000;

const TRUNCATED: &str = "\n\n(Memory is over the 4,000 character cap. Keep only what every Task needs.)";

/// The Memory prompt for a Workdir, or empty when the file is absent.
pub fn memory_prompt(workdir: &Path) -> String {
    let Ok(text) = fs::read_to_string(workdir.join("MEMORY.md")) else {
        return String::new();
    };
    let mut chars = text.chars();
    let capped: String = chars.by_ref().take(MEMORY_LIMIT).collect();
    if chars.next().is_some() {
        format!("{capped}{TRUNCATED}")
    } else {
        capped
    }
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
        let prompt = memory_prompt(dir.path());
        assert!(prompt.starts_with(&"a".repeat(MEMORY_LIMIT)));
        assert!(prompt.ends_with(TRUNCATED));
    }

    #[test]
    fn no_file_is_an_empty_memory() {
        let dir = tempdir().expect("dir");
        assert_eq!(memory_prompt(dir.path()), "");
    }
}
