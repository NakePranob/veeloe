import { ProviderError } from "./store";

/**
 * The key from the terminal without showing it, or all of stdin when that is a
 * pipe. Never an argument: those stay in shell history and in `ps`.
 */
export async function readKey(prompt = "Provider key: "): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return await new Response(Bun.stdin.stream()).text();
  process.stdout.write(prompt);
  // A listener, not `for await`: that never resumes a stdin readline has already read from.
  return new Promise((resolve, reject) => {
    let key = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(key);
    };
    const onData = (chunk: Buffer) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new ProviderError("cancelled, nothing was saved"));
        if (char === "\u007f") key = key.slice(0, -1);
        else key += char;
      }
    };
    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}
