import { rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

export function askOnTerminal(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    terminal.once("close", () => resolve(false)); // no answer is not a yes
    terminal.question(`${question} [y/N] `, (answer) => {
      resolve(answer.trim().toLowerCase() === "y");
      terminal.close();
    });
  });
}

/**
 * Starts this Machine over without needing any Controller (ADR 0031). The key
 * goes too: the Hub would keep it in the old Workspace and answer
 * hub.machine_taken forever. Its old row stays at the Hub until revocation.
 * The Agents and the Egress are forgotten too, so a new Workspace starts from nothing; their
 * folders stay on disk, where no Agent reads them (ADR 0035).
 */
export async function runUnpair({ home, confirm = askOnTerminal, log = console.log }: { home: string; confirm?: (question: string) => Promise<boolean>; log?: (line: string) => void }): Promise<boolean> {
  const yes = await confirm("This Machine will stop trusting every Controller and get a new key. Continue?");
  if (!yes) {
    log("nothing was changed");
    return false;
  }
  for (const file of ["runtime/trust.json", "runtime/seen.json", "runtime/agents.json", "runtime/egress.json", "machine.key"]) rmSync(join(home, file), { force: true });
  log("unpaired. To pair again, run: veeloe pair");
  return true;
}
