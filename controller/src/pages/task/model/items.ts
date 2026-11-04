type EventRow = { seq: number; kind: string; body: string };

/** What the Task screen draws, in order. Kinds this build does not know draw nothing (ADR 0023). */
export type Item = { key: string; kind: "member"; text: string } | { key: string; kind: "agent"; text: string } | { key: string; kind: "error"; code: string };

const textOf = (content: unknown) =>
  Array.isArray(content)
    ? content
        .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n\n")
    : "";

/** The log as the Owner reads it: their words, the Agent's text (never its thinking), and why a Turn failed. */
export function items(events: EventRow[]): { items: Item[]; working: boolean } {
  const out: Item[] = [];
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
    } else if (event.kind === "turn.started") open = true;
    else if (event.kind === "turn.ended") {
      open = false;
      if (body.reason === "error") out.push({ key, kind: "error", code: body.code ?? "provider.failed" });
    }
  }
  return { items: out, working: open };
}
