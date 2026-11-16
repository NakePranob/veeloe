//! The terminal prompts `veeloe`'s commands ask with (legacy `askLine`,
//! `choose`, `pickWithArrows`): a line, a numbered pick and an arrow pick.

/// Whether a person is at a terminal to answer; only then does any command ask
/// (legacy `interactive()`).
pub(crate) fn interactive() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

/// One line from the terminal, or `None` when stdin closes first (legacy
/// `askLine`).
pub(crate) fn ask_line(question: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
    use std::io::Write;
    print!("{question}");
    std::io::stdout().flush()?;
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line)? == 0 {
        return Ok(None);
    }
    Ok(Some(line.trim_end_matches(['\n', '\r']).trim().to_string()))
}

/// Asks until `check` takes the answer, or stdin closes (legacy `askValid`).
pub(crate) fn ask_valid<T>(
    question: &str,
    check: impl Fn(&str) -> Result<T, String>,
) -> Result<T, Box<dyn std::error::Error>> {
    loop {
        let Some(answer) = ask_line(question)? else {
            return Err("cancelled, nothing was saved".into());
        };
        match check(&answer) {
            Ok(value) => return Ok(value),
            Err(problem) => println!("{problem}"),
        }
    }
}

/// A numbered pick, asked again until it is one of them; `None` when stdin
/// closes (legacy `choose`).
pub(crate) fn choose(
    title: &str,
    labels: &[String],
) -> Result<Option<usize>, Box<dyn std::error::Error>> {
    println!("{title}");
    for (at, label) in labels.iter().enumerate() {
        println!("  {}) {label}", at + 1);
    }
    loop {
        let Some(answer) = ask_line(&format!("Choose 1-{}: ", labels.len()))? else {
            return Ok(None);
        };
        if let Ok(picked) = answer.parse::<usize>() {
            if picked >= 1 && picked <= labels.len() {
                return Ok(Some(picked - 1));
            }
        }
    }
}

/// What one keypress does to an arrow pick: move to `at`, pick it, or cancel
/// (legacy `pickKey`).
pub(crate) enum Pick {
    At(usize),
    Picked(usize),
    Cancel,
}

pub(crate) fn pick_key(key: &str, at: usize, count: usize) -> Pick {
    match key {
        "\u{1b}[A" | "k" => Pick::At((at + count - 1) % count),
        "\u{1b}[B" | "j" => Pick::At((at + 1) % count),
        "\r" | "\n" => Pick::Picked(at),
        "\u{3}" | "\u{1b}" | "q" => Pick::Cancel,
        _ => match key.parse::<usize>() {
            Ok(n) if n >= 1 && n <= count => Pick::Picked(n - 1),
            _ => Pick::At(at),
        },
    }
}

/// Raw mode for one pick, restored however it ends. False when this stdin is
/// not a terminal that can be put in it.
pub(crate) fn raw_mode(enable: bool, saved: &mut Option<libc::termios>) -> bool {
    unsafe {
        if enable {
            let mut term: libc::termios = std::mem::zeroed();
            if libc::tcgetattr(0, &mut term) != 0 {
                return false;
            }
            *saved = Some(term);
            let mut raw = term;
            raw.c_lflag &= !(libc::ICANON | libc::ECHO);
            raw.c_cc[libc::VMIN] = 1;
            raw.c_cc[libc::VTIME] = 0;
            libc::tcsetattr(0, libc::TCSANOW, &raw) == 0
        } else {
            saved
                .map(|original| libc::tcsetattr(0, libc::TCSANOW, &original) == 0)
                .unwrap_or(false)
        }
    }
}

pub(crate) fn draw_pick(labels: &[String], at: usize, first: bool) {
    use std::io::Write;
    let mut out = std::io::stdout();
    if !first {
        let _ = write!(out, "\u{1b}[{}A", labels.len());
    }
    for (index, label) in labels.iter().enumerate() {
        let line = if index == at {
            format!("\u{1b}[2K\u{1b}[36m› {label}\u{1b}[0m\n")
        } else {
            format!("\u{1b}[2K  {label}\n")
        };
        let _ = out.write_all(line.as_bytes());
    }
    let _ = out.flush();
}

/// Pick one of `labels` with the arrow keys and Enter, or its number; Esc,
/// Ctrl-C and `q` cancel. Falls back to the numbered pick when stdin cannot go
/// into raw mode (legacy `pickWithArrows`).
pub(crate) fn pick_with_arrows(
    title: &str,
    labels: &[String],
) -> Result<Option<usize>, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    let mut saved = None;
    if !raw_mode(true, &mut saved) {
        return choose(title, labels);
    }
    println!("{title} \u{1b}[2m(↑ ↓ to move, Enter to pick)\u{1b}[0m");
    let mut at = 0;
    draw_pick(labels, at, true);
    let mut stdin = std::io::stdin();
    let picked = loop {
        let mut buffer = [0u8; 8];
        let read = stdin.read(&mut buffer);
        let Ok(read) = read else {
            raw_mode(false, &mut saved);
            return Err("cancelled, nothing was saved".into());
        };
        if read == 0 {
            break None;
        }
        match pick_key(&String::from_utf8_lossy(&buffer[..read]), at, labels.len()) {
            Pick::At(moved) => {
                at = moved;
                draw_pick(labels, at, false);
            }
            Pick::Picked(picked) => {
                draw_pick(labels, at, false);
                break Some(picked);
            }
            Pick::Cancel => break None,
        }
    };
    raw_mode(false, &mut saved);
    let _ = std::io::stdout().flush();
    Ok(picked)
}

#[cfg(test)]
mod tests {
    use super::{pick_key, Pick};

    #[test]
    fn an_arrow_pick_moves_wraps_takes_a_number_and_cancels_as_the_legacy_one_did() {
        assert!(matches!(pick_key("\u{1b}[B", 0, 3), Pick::At(1)));
        assert!(matches!(pick_key("j", 2, 3), Pick::At(0)));
        assert!(matches!(pick_key("\u{1b}[A", 0, 3), Pick::At(2)));
        assert!(matches!(pick_key("k", 1, 3), Pick::At(0)));
        assert!(matches!(pick_key("\r", 1, 3), Pick::Picked(1)));
        assert!(matches!(pick_key("3", 0, 3), Pick::Picked(2)));
        // A number outside the list is not a pick.
        assert!(matches!(pick_key("9", 1, 3), Pick::At(1)));
        assert!(matches!(pick_key("\u{1b}", 0, 3), Pick::Cancel));
        assert!(matches!(pick_key("\u{3}", 0, 3), Pick::Cancel));
        assert!(matches!(pick_key("q", 0, 3), Pick::Cancel));
    }
}
