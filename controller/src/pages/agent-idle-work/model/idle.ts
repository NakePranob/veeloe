import { IDLE_ITEMS_MAX, TRIGGER_TEXT_MAX, type IdleProgress, type ListedTrigger, type Trigger } from "@veeloe/protocol-ts";

/** One piece as the sheet holds it while a Member writes the list. */
type DraftItem = { id: string; text: string; repeat: boolean };

/** What the sheet holds: the pieces, their order, and the two times in minutes. */
export type Draft = { items: DraftItem[]; order: "ordered" | "oldest-first"; quietMinutes: number; itemMinutes: number };

export type Problem = "empty" | "tooMany";

/** The quiet times and time limits the sheet offers, in minutes. */
export const QUIET_CHOICES = [5, 10, 15, 30, 60, 120, 240] as const;
export const ITEM_CHOICES = [5, 10, 15, 30, 60, 120] as const;
/** The shares of the Budget background work may take, in percent. */
export const SHARE_CHOICES = [0, 10, 20, 30, 50, 100] as const;

/** A list's words: an Idle Work list is named by the Agent's model, and this is what it reads. */
const LIST_TEXT = "Idle Work";

/** The list as signed, opened for editing, with the Agent's draft after it when asked. */
export function draftOf(list: ListedTrigger | undefined, proposed: readonly string[], newId: () => string): Draft {
  const idle = list?.idle;
  const kept = idle?.items.map((item) => ({ id: item.id, text: item.text, repeat: item.repeat ?? false })) ?? [];
  // A one-off piece already done is not on the list any more: only what `progress` still shows stays.
  const still = list?.progress ? new Set(list.progress.map((p) => p.id)) : null;
  const items = [...kept.filter((item) => !still || still.has(item.id)), ...proposed.map((text) => ({ id: newId(), text, repeat: false }))];
  return { items, order: idle?.order ?? "ordered", quietMinutes: idle?.quietMinutes ?? 15, itemMinutes: idle?.itemMinutes ?? 15 };
}

/** The Trigger a save signs, or why it cannot be. Its scope is the one the Machine holds now (ADR 0079). */
export function listOf(draft: Draft, id: string, allow: readonly string[] = []): Trigger | Problem {
  const items = draft.items.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text);
  if (items.length === 0) return "empty";
  if (items.length > IDLE_ITEMS_MAX || items.some((item) => item.text.length > TRIGGER_TEXT_MAX)) return "tooMany";
  return {
    id,
    kind: "idle",
    text: LIST_TEXT,
    idle: { items: items.map(({ id: item, text, repeat }) => ({ id: item, text, ...(repeat && { repeat }) })), order: draft.order, quietMinutes: draft.quietMinutes, itemMinutes: draft.itemMinutes },
    ...(allow.length > 0 && { allow: [...allow] }),
  };
}

/** Each piece still on the list with its words and where it stands, in the signed order. */
export function piecesOf(list: ListedTrigger): (IdleProgress & { text: string; repeat: boolean })[] {
  const items = new Map(list.idle?.items.map((item) => [item.id, item]) ?? []);
  return (list.progress ?? []).flatMap((progress) => {
    const item = items.get(progress.id);
    return item ? [{ ...progress, text: item.text, repeat: item.repeat ?? false }] : [];
  });
}
