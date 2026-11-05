import type { ToolRunner } from "../core/ports";

export const DEFAULT_TIMEOUT_S = 120;
export const MAX_TIMEOUT_S = 600;
/** What the LLM gets of one command's output at most: the end of it, where the error usually is. */
export const OUTPUT_LIMIT = 30_000;

const DESCRIPTION = `Runs a bash command on the owner's machine, in your working folder, and returns what it printed (stdout and stderr together) and its exit code.
Every command starts fresh in the working folder: cd, exported variables and shell functions do not carry over to the next command, so chain steps with && in one command.
There is no input: a command that waits for input gets none. A command that runs longer than its timeout is stopped with everything it started.
You can write only inside your own folder, and reach only the domains the owner allowed.`;

class Tail {
  private text = "";
  dropped = 0;
  add(chunk: string) {
    this.text += chunk;
    if (this.text.length > OUTPUT_LIMIT * 2) this.trim();
  }
  trim() {
    if (this.text.length <= OUTPUT_LIMIT) return this.text;
    this.dropped += this.text.length - OUTPUT_LIMIT;
    this.text = this.text.slice(-OUTPUT_LIMIT);
    return this.text;
  }
}

/**
 * The `bash` tool (`sandboxed-commands`). It runs inside the worker's sandbox,
 * so everything a command starts is under the same rules (ADR 0008). Each
 * command is its own process group in the Workdir, with no stdin and with no
 * variable the worker uses to reach the supervisor.
 *
 * ponytail: no shell kept between commands, and the description says so. Keep one if the LLM keeps tripping over cd.
 */
export function bashTool({ workdir, env, secondMs = 1000 }: { workdir: string; env: Record<string, string | undefined>; secondMs?: number }): ToolRunner {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("NODE_CHANNEL")));
  return {
    definitions: () => [
      {
        name: "bash",
        description: DESCRIPTION,
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command, one line or several." },
            timeout: { type: "number", description: `Seconds before it is stopped. Default ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S}.` },
          },
          required: ["command"],
        },
      },
    ],
    async run(name, input) {
      if (name !== "bash") throw new Error(`there is no tool named ${name}`);
      const { command, timeout } = (input ?? {}) as { command?: unknown; timeout?: unknown };
      if (typeof command !== "string" || command.trim() === "") throw new Error("bash needs a command");
      const seconds = typeof timeout === "number" && timeout > 0 ? Math.min(timeout, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;

      // `exec 2>&1` first, so stderr lands in the one pipe in the order it was written.
      const proc = Bun.spawn(["bash", "-c", `exec 2>&1\n${command}`], { cwd: workdir, env: childEnv, stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true });
      const killGroup = () => {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          // already gone
        }
      };
      const tail = new Tail();
      const reader = proc.stdout.getReader();
      const reading = (async () => {
        const decoder = new TextDecoder();
        for (let r = await reader.read(); !r.done; r = await reader.read()) tail.add(decoder.decode(r.value, { stream: true }));
        tail.add(decoder.decode());
      })().catch(() => {});

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, seconds * secondMs);
      const code = await proc.exited;
      clearTimeout(timer);
      // What the command left running in the background goes too, or it would hold the output open.
      // One that left the group (setsid) still may, so the output is read for a moment longer at most.
      killGroup();
      const late = setTimeout(() => void reader.cancel(), secondMs);
      await reading;
      clearTimeout(late);

      const text = tail.trim();
      const cut = tail.dropped ? `[the first ${tail.dropped} characters were cut]\n` : "";
      const end = timedOut ? `timed out after ${seconds} seconds, so it was stopped` : `exit code: ${code}`;
      const result = `${cut}${text}${text && !text.endsWith("\n") ? "\n" : ""}${end}`;
      if (timedOut || code !== 0) throw new Error(result);
      return result;
    },
  };
}
