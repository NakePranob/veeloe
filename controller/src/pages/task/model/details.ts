import { TaskTitled } from "@veeloe/protocol-ts";
import { items } from "./items";

type EventRow = { seq: number; kind: string; body: string; at?: number };

/** The parts of a request, in the order the Task details sheet lists them. */
const CONTEXT_PARTS = ["system", "memory", "tools", "summary", "you", "agent", "results"] as const;
export type ContextPart = (typeof CONTEXT_PARTS)[number];
export type ContextParts = { window: number; parts: { part: ContextPart; tokens: number }[]; used: number };

/**
 * The newest `context.usage` that says what each part weighs. A Runtime older than the breakdown writes none,
 * and the sheet then says nothing about context rather than a total it cannot split.
 */
export function contextPartsOf(events: EventRow[]): ContextParts | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== "context.usage") continue;
    try {
      const body = JSON.parse(event.body) as { window?: unknown; parts?: Record<string, unknown> };
      if (typeof body.window !== "number" || body.window <= 0 || !body.parts || typeof body.parts !== "object") return null;
      const parts = CONTEXT_PARTS.flatMap((part) => {
        const tokens = body.parts?.[part];
        return typeof tokens === "number" && tokens > 0 ? [{ part, tokens }] : [];
      });
      return { window: body.window, parts, used: parts.reduce((sum, p) => sum + p.tokens, 0) };
    } catch {
      return null;
    }
  }
  return null;
}

export type TaskFacts = {
  started: number | null;
  last: number | null;
  turns: number;
  changed: string[];
  sent: { name: string; size: number; hash: string; path: string }[];
};

/** What the sheet lists under the context: when, how many Turns, and the files the Agent changed and sent. */
export function factsOf(events: EventRow[]): TaskFacts {
  const at = events.filter((event) => event.at !== undefined && event.kind !== TaskTitled).map((event) => event.at as number);
  const log = items(events).items;
  const changed = [...new Set(log.flatMap((item) => (item.kind === "changes" ? item.files : [])))];
  const sent = log.flatMap((item) => (item.kind === "file" ? [{ name: item.name, size: item.size, hash: item.hash, path: item.path }] : []));
  return {
    started: at.length ? Math.min(...at) : null,
    last: at.length ? Math.max(...at) : null,
    turns: events.filter((event) => event.kind === "turn.started").length,
    changed,
    sent,
  };
}
