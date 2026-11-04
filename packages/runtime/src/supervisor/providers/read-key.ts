/**
 * The key from the terminal without showing it, or all of stdin when that is a
 * pipe. Never an argument: those stay in shell history and in `ps`.
 */
export async function readKey(prompt = "Provider key: "): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return await new Response(Bun.stdin.stream()).text();
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let key = "";
  try {
    for await (const chunk of stdin) {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") return key;
        if (char === "\u0003") throw new Error("cancelled");
        if (char === "\u007f") key = key.slice(0, -1);
        else key += char;
      }
    }
    return key;
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write("\n");
  }
}
