import { createInterface } from "node:readline";

/** Whether a person is at a terminal to answer; only then does any command ask. */
export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** One line from the terminal, or undefined when stdin closes first. */
export function askLine(question: string): Promise<string | undefined> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    terminal.once("close", () => resolve(undefined));
    terminal.question(question, (answer) => {
      resolve(answer.trim());
      terminal.close();
    });
  });
}

/** A yes only when the answer is y: Enter, anything else or a closed stdin is a no. */
export async function askOnTerminal(question: string): Promise<boolean> {
  return (await askLine(`${question} [y/N] `))?.toLowerCase() === "y";
}

/** What one keypress does to an arrow pick: move to `at`, pick it, or cancel. */
export function pickKey(key: string, at: number, count: number): { at: number } | { picked: number } | "cancel" {
  if (key === "\u001b[A" || key === "k") return { at: (at - 1 + count) % count };
  if (key === "\u001b[B" || key === "j") return { at: (at + 1) % count };
  if (key === "\r" || key === "\n") return { picked: at };
  if (key === "\u0003" || key === "\u001b" || key === "q") return "cancel";
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= count) return { picked: n - 1 };
  return { at };
}

/** Pick one of `labels` with ↑ ↓ and Enter (or its number). Undefined on Esc or Ctrl-C. */
export function pickWithArrows(title: string, labels: string[]): Promise<number | undefined> {
  const { stdin, stdout } = process;
  let at = 0;
  const draw = (first: boolean) => {
    if (!first) stdout.write(`\u001b[${labels.length}A`);
    labels.forEach((label, i) => stdout.write(`\u001b[2K${i === at ? `\u001b[36m› ${label}\u001b[0m` : `  ${label}`}\n`));
  };
  stdout.write(`${title} \u001b[2m(↑ ↓ to move, Enter to pick)\u001b[0m\n`);
  draw(true);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    const onKey = (data: Buffer) => {
      const result = pickKey(data.toString(), at, labels.length);
      if (result !== "cancel" && "at" in result) {
        at = result.at;
        return draw(false);
      }
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      if (result === "cancel") return resolve(undefined);
      at = result.picked;
      draw(false);
      resolve(result.picked);
    };
    stdin.on("data", onKey);
  });
}

/** A numbered pick, asked again until it is one of them. Undefined when stdin closes. */
export async function choose(ask: (question: string) => Promise<string | undefined>, log: (line: string) => void, title: string, labels: string[]): Promise<number | undefined> {
  log(title);
  labels.forEach((label, i) => log(`  ${i + 1}) ${label}`));
  for (;;) {
    const answer = await ask(`Choose 1-${labels.length}: `);
    if (answer === undefined) return undefined;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
  }
}
