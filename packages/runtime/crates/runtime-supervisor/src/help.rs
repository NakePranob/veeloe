//! What `veeloe --help` and `veeloe help <command>` print, ported word for word
//! from `packages/runtime-legacy/src/help.ts`. CLI text is English (ADR 0065 is
//! the Controller's).

pub const USAGE: &str =
    "usage: veeloe [pair | unpair | status | provider add|list|remove | help <command>]";

const COMMANDS: [(&str, &str); 5] = [
    (
        "start",
        "veeloe
  Start the Runtime: it connects to the Hub and runs every Agent on this Machine.
  The first time, at a terminal, it pairs this Machine and adds a Provider first.

  veeloe                               start (or set up, the first time)",
    ),
    (
        "pair",
        "veeloe pair [--hub <url>]
  Pair this Machine with the Veeloe app: shows a QR code and a link, and waits.

  veeloe pair                          use the Hub this Machine already knows
  veeloe pair --hub wss://hub.example.com",
    ),
    (
        "unpair",
        "veeloe unpair
  Forget every Controller, every Agent and this Machine's key, after asking.

  veeloe unpair",
    ),
    (
        "status",
        "veeloe status
  Show whether this Machine is paired, its Providers and Agents, whether the
  Runtime is running, and what to do next. Never shows a key.

  veeloe status",
    ),
    (
        "provider",
        "veeloe provider add [--preset <id> | --name <name> --url <base url>]
veeloe provider list
veeloe provider remove [<name>] [--yes]
  Set up the LLMs (Providers) your Agents use. The key is typed hidden, or piped
  in on stdin; it is never an argument. At a terminal, what is left out is asked.

  veeloe provider add                  pick a built-in Provider or enter a URL
  veeloe provider add --preset anthropic < key.txt
  veeloe provider add --name local --url http://localhost:8080 < key.txt
  veeloe provider list
  veeloe provider remove               pick one, see which Agents use it, confirm
  veeloe provider remove main --yes    no question asked (needed without a terminal)

  Built-in: anthropic, opencode-go, openrouter",
    ),
];

/// The help of one command, or of all of them. `None` for a command there is
/// none of, which the CLI refuses by name.
pub fn help_for(command: Option<&str>) -> Option<String> {
    match command {
        None => Some(format!(
            "Veeloe Runtime: your Agents, on this Machine.\n\n{}\n\nMore on one command: veeloe help <command>",
            COMMANDS
                .iter()
                .map(|(_, text)| *text)
                .collect::<Vec<_>>()
                .join("\n\n")
        )),
        Some(command) => {
            let name = if command == "veeloe" { "start" } else { command };
            COMMANDS
                .iter()
                .find(|(id, _)| *id == name)
                .map(|(_, text)| text.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_of_them_names_every_command_and_points_at_one_command_help() {
        let all = help_for(None).expect("all");
        assert!(all.starts_with("Veeloe Runtime: your Agents, on this Machine."));
        for command in ["start", "pair", "unpair", "status", "provider"] {
            assert!(help_for(Some(command)).is_some(), "{command}");
        }
        assert!(all.ends_with("More on one command: veeloe help <command>"));
        assert!(all.contains("Built-in: anthropic, opencode-go, openrouter"));
    }

    #[test]
    fn one_command_is_its_own_text_and_veeloe_means_start() {
        assert_eq!(help_for(Some("veeloe")), help_for(Some("start")));
        assert_eq!(
            help_for(Some("status")).expect("status"),
            "veeloe status\n  Show whether this Machine is paired, its Providers and Agents, whether the\n  Runtime is running, and what to do next. Never shows a key.\n\n  veeloe status"
        );
        assert_eq!(help_for(Some("deploy")), None);
    }
}
