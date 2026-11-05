type EventRow = { seq: number; kind: string; body: string };

/** One command the Agent asked for, by the tool's own id, and how it went so far. */
export type ToolCall = { id: string; command: string; state: "running" | "ok" | "failed" | "unfinished"; output?: string };

/** What the Task screen draws, in order. Kinds this build does not know draw nothing (ADR 0023). */
export type Item =
  | { key: string; kind: "member"; text: string }
  | { key: string; kind: "agent"; text: string }
  | { key: string; kind: "error"; code: string }
  /** Commands run back to back, with no words of the Agent between them (controller-prototype's items). */
  | { key: string; kind: "tools"; calls: ToolCall[] };

const textOf = (content: unknown) =>
  Array.isArray(content)
    ? content
        .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n\n")
    : "";

// The command when the tool has one, so a file tool of `workdir-file-tools` shows by its name on the same row.
const commandOf = (use: { name?: unknown; input?: unknown }) => {
  const command = (use.input as { command?: unknown } | null)?.command;
  return typeof command === "string" ? command : String(use.name ?? "");
};

type ToolUse = { type: "tool_use"; id: string; name?: unknown; input?: unknown };
type ToolResult = { tool_use_id?: unknown; content?: unknown; is_error?: unknown };

/** The log as the Owner reads it: their words, the Agent's text (never its thinking), its commands and why a Turn failed. */
export function items(events: EventRow[]): { items: Item[]; working: boolean } {
  const out: Item[] = [];
  const calls = new Map<string, ToolCall>();
  let open = false;
  for (const event of events) {
    let body: { text?: string; content?: unknown; reason?: string; code?: string };
    try {
      body = JSON.parse(event.body) ?? {};
    } catch {
      continue;
    }
    const key = String(event.seq);
    if (event.kind === "member.message" && body.text) out.push({ key, kind: "member", text: body.text });
    else if (event.kind === "llm.message") {
      const text = textOf(body.content);
      if (text) out.push({ key, kind: "agent", text });
      const uses = Array.isArray(body.content) ? body.content.filter((block): block is ToolUse => block?.type === "tool_use" && typeof block.id === "string") : [];
      for (const use of uses) {
        const call: ToolCall = { id: use.id, command: commandOf(use), state: "running" };
        calls.set(use.id, call);
        const last = out.at(-1);
        if (last?.kind === "tools") last.calls.push(call);
        else out.push({ key: `${key}-tools`, kind: "tools", calls: [call] });
      }
    } else if (event.kind === "tool.result" && Array.isArray(body.content)) {
      for (const result of body.content as ToolResult[]) {
        const call = calls.get(String(result?.tool_use_id));
        if (call?.state !== "running") continue;
        call.state = result.is_error ? "failed" : "ok";
        call.output = typeof result.content === "string" ? result.content : textOf(result.content);
      }
    } else if (event.kind === "turn.started") open = true;
    else if (event.kind === "turn.ended") {
      open = false;
      // A command the Turn ended before it answered never will.
      for (const call of calls.values()) if (call.state === "running") call.state = "unfinished";
      if (body.reason === "error") out.push({ key, kind: "error", code: body.code ?? "provider.failed" });
    }
  }
  return { items: out, working: open };
}
