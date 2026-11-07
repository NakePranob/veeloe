type EventRow = { seq: number; kind: string; body: string };

/** One command the Agent asked for, by the tool's own id, and how it went so far. */
export type ToolCall = { id: string; command: string; state: "running" | "ok" | "failed" | "unfinished"; output?: string };

/**
 * Where one Approval stands (controller-prototype's ApprovalStatus). `expired`: its
 * time ran out with nobody answering, which counts as denied (CONTEXT.md).
 * `closed`: its Turn ended first, by Stop or a steer.
 */
export type ApprovalStatus = "open" | "approved" | "denied" | "expired" | "closed";

/** One Approval the Agent asked for, and how it ended. */
export type Approval = {
  request: string;
  command: string;
  parts: string[];
  expiresAt: number;
  /** What the Agent said it needs this for, when it said. */
  reason?: string;
  status: ApprovalStatus;
  /** Who answered: absent while open, and for one that expired or closed with no answer. */
  answeredBy?: { member: string; decision: string; message?: string };
};

/** What the Task screen draws, in order. Kinds this build does not know draw nothing (ADR 0023). */
export type Item =
  | { key: string; kind: "member"; text: string }
  | { key: string; kind: "agent"; text: string }
  | { key: string; kind: "error"; code: string }
  /** Commands run back to back, with no words of the Agent between them (controller-prototype's items). */
  | { key: string; kind: "tools"; calls: ToolCall[] }
  | { key: string; kind: "approval"; approval: Approval };

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

/**
 * The log as the Owner reads it: their words, the Agent's text (never its
 * thinking), its commands, its Approvals and why a Turn failed.
 * `now` decides whether a wait still counts as waiting.
 */
export function items(events: EventRow[], now = Date.now()): { items: Item[]; working: boolean } {
  const out: Item[] = [];
  const calls = new Map<string, ToolCall>();
  const approvals = new Map<string, { item: Extract<Item, { kind: "approval" }>; index: number }>();
  let open = false;
  for (const event of events) {
    let body: { text?: string; content?: unknown; reason?: string; code?: string; request?: string; command?: string; parts?: string[]; expiresAt?: number; member?: string; decision?: string; message?: string };
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
    } else if (event.kind === "approval.requested" && typeof body.request === "string" && typeof body.command === "string") {
      const item: Extract<Item, { kind: "approval" }> = {
        key,
        kind: "approval",
        approval: {
          request: body.request,
          command: body.command,
          parts: Array.isArray(body.parts) ? body.parts.filter((part): part is string => typeof part === "string") : [body.command],
          expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : now,
          ...(typeof body.reason === "string" && { reason: body.reason }),
          status: "open",
        },
      };
      approvals.set(body.request, { item, index: out.length });
      out.push(item);
    } else if (event.kind === "approval.answered" && typeof body.request === "string" && typeof body.decision === "string") {
      const found = approvals.get(body.request);
      if (found) {
        // The Machine writes the expiry itself, as a denial with nobody's name on it.
        const expired = typeof body.member !== "string";
        found.item.approval.status = expired ? "expired" : body.decision === "approve" ? "approved" : "denied";
        if (typeof body.member === "string") found.item.approval.answeredBy = { member: body.member, decision: body.decision, ...(typeof body.message === "string" && { message: body.message }) };
      }
    } else if (event.kind === "turn.started") open = true;
    else if (event.kind === "turn.ended") {
      open = false;
      // A command the Turn ended before it answered never will.
      for (const call of calls.values()) if (call.state === "running") call.state = "unfinished";
      // An Approval its Turn ended before anyone answered is closed, as the prototype's `approvals` does.
      for (const { item } of approvals.values()) if (item.approval.status === "open") item.approval.status = "closed";
      if (body.reason === "error") out.push({ key, kind: "error", code: body.code ?? "provider.failed" });
    }
  }
  // Nobody answered in time: it counts as denied (CONTEXT.md).
  for (const { item } of approvals.values()) if (item.approval.status === "open" && item.approval.expiresAt <= now) item.approval.status = "expired";
  return { items: out, working: open };
}
