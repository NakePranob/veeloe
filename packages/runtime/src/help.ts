// What `veeloe --help` and `veeloe help <command>` print. CLI text is English (ADR 0065 is the Controller's).
const commands: Record<string, string> = {
  start: `veeloe
  Start the Runtime: it connects to the Hub and runs every Agent on this Machine.
  The first time, at a terminal, it pairs this Machine and adds a Provider first.

  veeloe                               start (or set up, the first time)`,
  pair: `veeloe pair [--hub <url>]
  Pair this Machine with the Veeloe app: shows a QR code and a link, and waits.

  veeloe pair                          use the Hub this Machine already knows
  veeloe pair --hub wss://hub.example.com`,
  unpair: `veeloe unpair
  Forget every Controller, every Agent and this Machine's key, after asking.

  veeloe unpair`,
  status: `veeloe status
  Show whether this Machine is paired, its Providers and Agents, whether the
  Runtime is running, and what to do next. Never shows a key.

  veeloe status`,
  provider: `veeloe provider add [--preset <id> | --name <name> --url <base url>]
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

  Built-in: anthropic, opencode-go, openrouter`,
};

export const USAGE = "usage: veeloe [pair | unpair | status | provider add|list|remove | help <command>]";

/** The help of one command, or of all of them. Undefined for a command there is none of. */
export function helpFor(command?: string): string | undefined {
  if (command === undefined) return `Veeloe Runtime: your Agents, on this Machine.\n\n${Object.values(commands).join("\n\n")}\n\nMore on one command: veeloe help <command>`;
  return commands[command === "veeloe" ? "start" : command];
}
