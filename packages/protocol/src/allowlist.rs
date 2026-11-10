//! The Allowlist of one Agent (ADR 0030), ported from
//! `packages/protocol-legacy/src/messages/allowlist.ts`.
//!
//! Each entry is a command prefix for `bash`, or the exact name of a Connector
//! tool. The rule is security code: anything it cannot split with certainty
//! answers "no", so the call goes to an Approval instead. Fail closed.

/// The read-only set the New Agent screen ticks for you (`approval-and-allowlist`).
pub const READ_ONLY_ALLOWLIST: [&str; 9] = [
    "ls",
    "pwd",
    "cat",
    "head",
    "tail",
    "wc",
    "git status",
    "git diff",
    "git log",
];

/// How many entries one Agent may hold.
pub const ALLOWLIST_MAX: usize = 100;

/// A command that runs in place of the process or interprets another command:
/// always needs an Approval.
const DANGEROUS_FIRST: [&str; 2] = ["eval", "exec"];
/// A wrapper that hands the work to the next word: `builtin eval ...` is as
/// dangerous as `eval ...`.
const WRAPPERS: [&str; 2] = ["builtin", "command"];

/// Splits one command into its parts at `&&`, `||`, `;`, `|`, `&` and a
/// newline, without splitting inside single quotes, double quotes, or after a
/// backslash. Empty parts are dropped; a trailing `&` (background) leaves the
/// same part behind.
pub fn split_command(command: &str) -> Vec<String> {
    let chars: Vec<char> = command.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if escaped {
            current.push(ch);
            escaped = false;
            i += 1;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            escaped = true;
            current.push(ch);
            i += 1;
            continue;
        }
        if let Some(open) = quote {
            current.push(ch);
            if ch == open {
                quote = None;
            }
            i += 1;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            current.push(ch);
            i += 1;
            continue;
        }
        if ch == '\n' || ch == ';' {
            push_part(&mut current, &mut parts);
            i += 1;
            continue;
        }
        if (ch == '&' || ch == '|') && chars.get(i + 1) == Some(&ch) {
            push_part(&mut current, &mut parts);
            i += 2;
            continue;
        }
        if ch == '&' || ch == '|' {
            push_part(&mut current, &mut parts);
            i += 1;
            continue;
        }
        current.push(ch);
        i += 1;
    }
    push_part(&mut current, &mut parts);
    parts
}

fn push_part(current: &mut String, parts: &mut Vec<String>) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        parts.push(trimmed.to_string());
    }
    current.clear();
}

/// A half-open range of characters to blank out before looking for redirects.
type Span = (usize, usize);

/// The spans inside quotes, after a backslash, and inside `[[ ... ]]` /
/// `(( ... ))`, where `<` and `>` are comparisons and not redirects.
fn blank_spans(chars: &[char]) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if escaped {
            spans.push((i - 1, i + 1));
            escaped = false;
            i += 1;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            escaped = true;
            i += 1;
            continue;
        }
        if let Some(open) = quote {
            spans.push((i, i + 1));
            if ch == open {
                quote = None;
            }
            i += 1;
            continue;
        }
        if ch == '\'' || ch == '"' {
            spans.push((i, i + 1));
            quote = Some(ch);
            i += 1;
            continue;
        }
        if (ch == '[' && chars.get(i + 1) == Some(&'['))
            || (ch == '(' && chars.get(i + 1) == Some(&'('))
        {
            let close: [char; 2] = if ch == '[' { [']', ']'] } else { [')', ')'] };
            let mut end = None;
            let mut at = i + 2;
            while at + 1 < chars.len() {
                if chars[at] == close[0] && chars[at + 1] == close[1] {
                    end = Some(at);
                    break;
                }
                at += 1;
            }
            let Some(end) = end else {
                i += 1;
                continue;
            };
            spans.push((i, end + 2));
            i = end + 2;
            continue;
        }
        i += 1;
    }
    if escaped {
        spans.push((chars.len() - 1, chars.len()));
    }
    spans
}

fn blanked(chars: &[char], spans: &[Span]) -> String {
    let mut out = chars.to_vec();
    let len = out.len();
    for &(from, to) in spans {
        for slot in out.iter_mut().take(to.min(len)).skip(from) {
            *slot = ' ';
        }
    }
    out.into_iter().collect()
}

/// Says this command cannot be split with certainty, so it always needs an
/// Approval (ADR 0030): it has `$(...)`, a backtick, a redirect (`>`, `>>`,
/// `>|`, `>&`, `<`, `<>`, `<<`, heredoc), or runs `eval` / `exec` as the first
/// word of any part (including `builtin` / `command` wrapping those two).
/// Markers inside quotes, after a backslash, and inside `[[ ... ]]` /
/// `(( ... ))` are ignored, because they are not commands there.
pub fn is_unsafe_command(command: &str) -> bool {
    let chars: Vec<char> = command.chars().collect();
    let code = blanked(&chars, &blank_spans(&chars));
    if code.contains("$(") || code.contains('`') {
        return true;
    }
    if code.contains('>') || code.contains('<') {
        return true;
    }
    split_command(&code).iter().any(|part| {
        let words: Vec<&str> = part.split_whitespace().collect();
        let Some(first) = words.first().copied() else {
            return false;
        };
        if DANGEROUS_FIRST.contains(&first) {
            return true;
        }
        let second = words.get(1).copied();
        WRAPPERS.contains(&first) && second.is_some_and(|word| DANGEROUS_FIRST.contains(&word))
    })
}

fn words(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Says whether this command may run without asking: it must not be unsafe,
/// and every part must start with at least one Allowlist entry, compared word
/// by word from the start of the part.
pub fn matches_allowlist(command: &str, allowlist: &[String]) -> bool {
    if is_unsafe_command(command) {
        return false;
    }
    let parts = split_command(command);
    if parts.is_empty() {
        return false;
    }
    parts
        .iter()
        .all(|part| allowlist.iter().any(|entry| entry_covers(entry, part)))
}

/// Says whether one entry covers this command as a prefix, compared word by
/// word from the start — without the safety rules that decide whether a command
/// may run at all. The Allowlist screen shows what covers what with this, so a
/// part that still asks because it cannot be split with certainty (ADR 0030)
/// says which entry would have covered it rather than that no entry does.
pub fn entry_covers(entry: &str, command: &str) -> bool {
    let entry_words = words(entry);
    let command_words = words(command);
    !entry_words.is_empty()
        && command_words.len() >= entry_words.len()
        && entry_words
            .iter()
            .enumerate()
            .all(|(index, word)| command_words[index] == *word)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> Vec<String> {
        let mut all: Vec<String> = READ_ONLY_ALLOWLIST.iter().map(|s| s.to_string()).collect();
        all.push("npm test".into());
        all
    }

    fn owned(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn splits_on_the_joiners_and_a_lone_ampersand() {
        assert_eq!(split_command("git status && ls"), ["git status", "ls"]);
        assert_eq!(split_command("git status; ls"), ["git status", "ls"]);
        assert_eq!(split_command("ls | head"), ["ls", "head"]);
        assert_eq!(split_command("a || b"), ["a", "b"]);
        assert_eq!(split_command("ls & rm -rf dist"), ["ls", "rm -rf dist"]);
    }

    #[test]
    fn a_trailing_ampersand_runs_the_same_part_in_the_background() {
        assert_eq!(split_command("sleep 1 &"), ["sleep 1"]);
    }

    #[test]
    fn splits_on_newlines_and_drops_empty_parts() {
        assert_eq!(split_command("ls\n\npwd\n"), ["ls", "pwd"]);
    }

    #[test]
    fn does_not_split_inside_quotes() {
        assert_eq!(split_command("echo \"a && b\""), ["echo \"a && b\""]);
        assert_eq!(split_command("echo 'a; b'"), ["echo 'a; b'"]);
        assert_eq!(
            split_command("echo \"a | b\" && ls"),
            ["echo \"a | b\"", "ls"]
        );
    }

    #[test]
    fn flags_substitution_backticks_eval_and_exec() {
        assert!(is_unsafe_command("echo $(rm -rf dist)"));
        assert!(is_unsafe_command("echo `rm -rf dist`"));
        assert!(is_unsafe_command("eval echo hi"));
        assert!(is_unsafe_command("exec 3>&1"));
        assert!(is_unsafe_command("ls && eval foo"));
        assert!(is_unsafe_command("builtin exec foo"));
        assert!(is_unsafe_command("command eval foo"));
    }

    #[test]
    fn flags_redirections_and_heredocs_even_glued_to_words() {
        assert!(is_unsafe_command("ls > /etc/passwd"));
        assert!(is_unsafe_command("echo hi>out.txt"));
        assert!(is_unsafe_command("cat < /etc/shadow"));
        assert!(is_unsafe_command("cat <<EOF"));
        assert!(is_unsafe_command("cmd 2>&1"));
        assert!(is_unsafe_command("diff <(a) <(b)"));
    }

    #[test]
    fn ignores_markers_in_quotes_after_a_backslash_or_as_comparisons() {
        assert!(!is_unsafe_command("echo \"$(not a command)\""));
        assert!(!is_unsafe_command("echo '`not a command`'"));
        assert!(!is_unsafe_command("echo \"a > b\""));
        assert!(!is_unsafe_command("echo a\\>b"));
        assert!(!is_unsafe_command("[[ $x > 1 ]] && echo big"));
        assert!(!is_unsafe_command("for ((i = 0; i < 10; i++)); do echo $i; done"));
    }

    #[test]
    fn plain_commands_are_safe() {
        assert!(!is_unsafe_command("npm test -- --watch"));
        assert!(!is_unsafe_command("git status && ls"));
    }

    #[test]
    fn a_lone_ampersand_is_a_separator_not_a_danger() {
        assert!(!is_unsafe_command("sleep 1 &"));
    }

    #[test]
    fn a_prefix_covers_extra_flags() {
        assert!(matches_allowlist("npm test -- --watch", &list()));
    }

    #[test]
    fn a_longer_word_is_not_covered() {
        assert!(!matches_allowlist("npm tester", &list()));
    }

    #[test]
    fn every_part_must_pass_including_across_a_background_ampersand() {
        assert!(matches_allowlist("git status && ls", &list()));
        assert!(!matches_allowlist("git status && rm -rf dist", &list()));
        assert!(matches_allowlist("ls | head", &list()));
        assert!(!matches_allowlist("ls & rm -rf dist", &list()));
        assert!(matches_allowlist("sleep 1 &", &owned(&["sleep 1"])));
    }

    #[test]
    fn unsafe_commands_always_need_approval() {
        assert!(!matches_allowlist("echo $(rm -rf dist)", &owned(&["echo"])));
        assert!(!matches_allowlist("eval echo hi", &owned(&["echo", "eval"])));
        assert!(!matches_allowlist("ls > out.txt", &owned(&["ls"])));
        assert!(!matches_allowlist("exec node server.js", &owned(&["exec", "node"])));
    }

    #[test]
    fn a_pipe_to_an_uncovered_command_needs_approval() {
        assert!(!matches_allowlist("ls | sort", &list()));
        let mut wider = list();
        wider.push("sort".into());
        assert!(matches_allowlist("ls | sort", &wider));
    }

    #[test]
    fn extra_whitespace_still_matches_word_by_word() {
        assert!(matches_allowlist("git   status", &owned(&["git status"])));
    }

    #[test]
    fn an_empty_command_or_empty_allowlist_never_passes() {
        assert!(!matches_allowlist("", &list()));
        assert!(!matches_allowlist("ls", &[]));
    }

    #[test]
    fn an_entry_covers_a_prefix_without_deciding_that_it_runs() {
        assert!(entry_covers("npm test", "npm test -- --watch"));
        assert!(!entry_covers("npm test", "npm tester"));
        // The prefix still holds where the command always asks: this is what the
        // Allowlist screen says covered a part, though the part is not allowed.
        assert!(entry_covers("echo", "echo $(rm -rf dist)"));
        assert!(!matches_allowlist("echo $(rm -rf dist)", &owned(&["echo"])));
        assert!(!entry_covers("", "ls"));
    }
}
