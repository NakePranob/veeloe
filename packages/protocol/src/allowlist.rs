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

/// Commands that pass without being on any Allowlist (ADR 0075): they print or
/// read, and run no other program. `date`, `sort`, `find`, `rg` and `git` pass
/// too, apart from the flags `built_in_covers` names.
const BUILT_IN: [&str; 25] = [
    "echo", "printf", "true", "false", "pwd", "which", "basename", "dirname", "ls", "cat", "head",
    "tail", "wc", "file", "stat", "du", "tree", "uniq", "cut", "tr", "diff", "cmp", "grep",
    "egrep", "fgrep",
];
/// `git` subcommands that only read the repository.
const GIT_READS: [&str; 7] = [
    "status",
    "diff",
    "log",
    "show",
    "rev-parse",
    "blame",
    "ls-files",
];
/// The only words `git branch` may carry and still pass: each lists, none changes a branch.
const GIT_BRANCH_FLAGS: [&str; 12] = [
    "-a",
    "-r",
    "-v",
    "-vv",
    "-l",
    "--all",
    "--remotes",
    "--verbose",
    "--list",
    "--show-current",
    "--no-color",
    "--color",
];
/// `find` actions that run a program, delete, or write a file.
const FIND_ACTIONS: [&str; 9] = [
    "-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls",
];

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

/// A character that ends a word for a redirect: space, a joiner, or a bracket.
fn is_gap(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, ';' | '|' | '&' | '(' | ')')
}

fn ends_at(chars: &[char], at: usize) -> bool {
    at >= chars.len() || is_gap(chars[at])
}

/// The redirects that write no file (ADR 0075): `>` or `>>` into `/dev/null`
/// with any file descriptor or `&` before it, and `>&1` / `>&2`. Read from the
/// blanked code, so a marker inside quotes is never one. Any other redirect is
/// left for `is_unsafe_command` to refuse.
fn null_redirects(code: &[char]) -> Vec<Span> {
    const NULL: [char; 9] = ['/', 'd', 'e', 'v', '/', 'n', 'u', 'l', 'l'];
    let mut spans = Vec::new();
    let mut i = 0;
    while i < code.len() {
        if code[i] != '>' {
            i += 1;
            continue;
        }
        let start = if i > 0
            && (code[i - 1].is_ascii_digit() || code[i - 1] == '&')
            && (i == 1 || is_gap(code[i - 2]))
        {
            i - 1
        } else {
            i
        };
        if code.get(i + 1) == Some(&'&')
            && matches!(code.get(i + 2), Some('1') | Some('2'))
            && ends_at(code, i + 3)
        {
            spans.push((start, i + 3));
            i += 3;
            continue;
        }
        let mut at = if code.get(i + 1) == Some(&'>') {
            i + 2
        } else {
            i + 1
        };
        while at < code.len() && code[at] == ' ' {
            at += 1;
        }
        if code.len() >= at + NULL.len()
            && code[at..at + NULL.len()] == NULL
            && ends_at(code, at + NULL.len())
        {
            spans.push((start, at + NULL.len()));
            i = at + NULL.len();
            continue;
        }
        i += 1;
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
/// `>|`, `>&`, `<`, `<>`, `<<`, heredoc) other than one into `/dev/null` or
/// `>&1` / `>&2` (ADR 0075), or runs `eval` / `exec` as the first word of any
/// part (including `builtin` / `command` wrapping those two). Markers inside
/// quotes, after a backslash, and inside `[[ ... ]]` / `(( ... ))` are
/// ignored, because they are not commands there.
pub fn is_unsafe_command(command: &str) -> bool {
    let chars: Vec<char> = command.chars().collect();
    let code: Vec<char> = blanked(&chars, &blank_spans(&chars)).chars().collect();
    let code = blanked(&code, &null_redirects(&code));
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

/// The command with its redirects into `/dev/null` (and `>&1` / `>&2`) blanked
/// out, so `cat MEMORY.md 2>/dev/null` is matched as `cat MEMORY.md`.
fn without_null_redirects(command: &str) -> String {
    let chars: Vec<char> = command.chars().collect();
    let code: Vec<char> = blanked(&chars, &blank_spans(&chars)).chars().collect();
    blanked(&chars, &null_redirects(&code))
}

/// Says whether this command may run without asking: it must not be unsafe,
/// and every part must start with at least one Allowlist entry, compared word
/// by word from the start of the part, or be a built-in command (ADR 0075).
pub fn matches_allowlist(command: &str, allowlist: &[String]) -> bool {
    if is_unsafe_command(command) {
        return false;
    }
    let parts = split_command(&without_null_redirects(command));
    if parts.is_empty() {
        return false;
    }
    parts.iter().all(|part| {
        built_in_covers(part) || allowlist.iter().any(|entry| entry_covers(entry, part))
    })
}

/// A word as bash passes it on: quotes dropped, a backslash keeps only the next
/// character. Close enough to tell `'-ex'ec` and `-e\xec` are `-exec`.
fn unquoted(word: &str) -> String {
    let mut out = String::new();
    let mut chars = word.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' | '"' => {}
            '\\' => out.extend(chars.next()),
            _ => out.push(ch),
        }
    }
    out
}

/// Says whether one part passes without any Allowlist entry (ADR 0075): it
/// prints or reads and runs no other program. Call it on a part that
/// `is_unsafe_command` already let through.
pub fn built_in_covers(part: &str) -> bool {
    let words: Vec<String> = part.split_whitespace().map(unquoted).collect();
    let Some((first, rest)) = words.split_first() else {
        return false;
    };
    match first.as_str() {
        // Setting the clock: `-s`, `--set`, and short flags bundled with `s`.
        "date" => !rest.iter().any(|w| {
            w.starts_with("--set")
                || (w.starts_with('-') && !w.starts_with("--") && w.contains('s'))
        }),
        "sort" => !rest.iter().any(|w| w.starts_with("--compress-program")),
        "rg" => !rest.iter().any(|w| w.starts_with("--pre")),
        "find" => !rest.iter().any(|w| FIND_ACTIONS.contains(&w.as_str())),
        "git" => match rest.split_first() {
            Some((sub, flags)) if sub == "branch" => {
                flags.iter().all(|w| GIT_BRANCH_FLAGS.contains(&w.as_str()))
            }
            Some((sub, _)) => GIT_READS.contains(&sub.as_str()),
            None => false,
        },
        name => BUILT_IN.contains(&name),
    }
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
        assert!(is_unsafe_command("cmd 2>out.txt"));
        assert!(is_unsafe_command("cmd >&out.txt"));
        assert!(is_unsafe_command("diff <(a) <(b)"));
    }

    #[test]
    fn ignores_markers_in_quotes_after_a_backslash_or_as_comparisons() {
        assert!(!is_unsafe_command("echo \"$(not a command)\""));
        assert!(!is_unsafe_command("echo '`not a command`'"));
        assert!(!is_unsafe_command("echo \"a > b\""));
        assert!(!is_unsafe_command("echo a\\>b"));
        assert!(!is_unsafe_command("[[ $x > 1 ]] && echo big"));
        assert!(!is_unsafe_command(
            "for ((i = 0; i < 10; i++)); do echo $i; done"
        ));
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
        assert!(!matches_allowlist(
            "eval echo hi",
            &owned(&["echo", "eval"])
        ));
        assert!(!matches_allowlist("ls > out.txt", &owned(&["ls"])));
        assert!(!matches_allowlist(
            "exec node server.js",
            &owned(&["exec", "node"])
        ));
    }

    #[test]
    fn a_pipe_to_an_uncovered_command_needs_approval() {
        assert!(!matches_allowlist("ls | xargs rm", &list()));
        let mut wider = list();
        wider.push("xargs rm".into());
        assert!(matches_allowlist("ls | xargs rm", &wider));
    }

    #[test]
    fn extra_whitespace_still_matches_word_by_word() {
        assert!(matches_allowlist("git   status", &owned(&["git status"])));
    }

    #[test]
    fn an_empty_command_never_passes_and_an_empty_allowlist_passes_only_built_ins() {
        assert!(!matches_allowlist("", &list()));
        assert!(!matches_allowlist("npm test", &[]));
        assert!(matches_allowlist("ls", &[]));
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

    #[test]
    fn redirects_into_dev_null_and_between_streams_write_nothing() {
        assert!(!is_unsafe_command("cat MEMORY.md 2>/dev/null"));
        assert!(!is_unsafe_command("ls memory 2> /dev/null"));
        assert!(!is_unsafe_command("make >/dev/null 2>&1"));
        assert!(!is_unsafe_command("make &>/dev/null"));
        assert!(!is_unsafe_command("echo hi 1>&2"));
        assert!(!is_unsafe_command("cat x >>/dev/null"));
    }

    #[test]
    fn a_redirect_that_only_looks_like_dev_null_still_asks() {
        assert!(is_unsafe_command("cat x >/dev/nullx"));
        assert!(is_unsafe_command("cat x >/dev/null/../../etc/passwd"));
        assert!(is_unsafe_command("cat x >\"/dev/null\""));
        assert!(is_unsafe_command("cat x >&3"));
        assert!(is_unsafe_command("cat x >| /dev/null"));
        assert!(is_unsafe_command("cat x 2>/dev/null </etc/shadow"));
    }

    #[test]
    fn built_in_commands_pass_with_no_allowlist() {
        let none: Vec<String> = Vec::new();
        assert!(matches_allowlist(
            "ls -la; echo \"---\"; cat MEMORY.md 2>/dev/null; echo \"---\"; ls memory 2>/dev/null",
            &none
        ));
        assert!(matches_allowlist(
            "grep -rn TODO src | sort | uniq -c",
            &none
        ));
        assert!(matches_allowlist("find . -name '*.ts'", &none));
        assert!(matches_allowlist("rg -n foo", &none));
        assert!(matches_allowlist("git show HEAD~1", &none));
        assert!(matches_allowlist("git branch -a", &none));
        assert!(matches_allowlist("date +%Y", &none));
    }

    #[test]
    fn built_ins_that_would_run_a_program_or_change_things_still_ask() {
        let none: Vec<String> = Vec::new();
        assert!(!matches_allowlist("find . -exec rm {} ;", &none));
        assert!(!matches_allowlist("find . -e\\xec rm {} +", &none));
        assert!(!matches_allowlist("find . '-delete'", &none));
        assert!(!matches_allowlist("rg --pre ./evil foo", &none));
        assert!(!matches_allowlist("rg --pre-glob '*' --pre sh foo", &none));
        assert!(!matches_allowlist("sort --compress-program=sh x", &none));
        assert!(!matches_allowlist("date -s 2020-01-01", &none));
        assert!(!matches_allowlist("date -us 2020", &none));
        assert!(!matches_allowlist("git branch -D main", &none));
        assert!(!matches_allowlist(
            "git branch --set-upstream-to=origin/x",
            &none
        ));
        assert!(!matches_allowlist("git -c diff.external=sh diff", &none));
        assert!(!matches_allowlist("git commit -m x", &none));
        assert!(!matches_allowlist("echo x | sh", &none));
        assert!(!matches_allowlist("rm -rf dist", &none));
        assert!(!matches_allowlist("echo hi > notes.txt", &none));
    }

    #[test]
    fn an_allowlist_entry_still_covers_a_part_with_a_null_redirect() {
        assert!(matches_allowlist("npm test 2>&1", &owned(&["npm test"])));
        assert!(!matches_allowlist(
            "npm run build 2>/dev/null",
            &owned(&["npm test"])
        ));
    }
}
