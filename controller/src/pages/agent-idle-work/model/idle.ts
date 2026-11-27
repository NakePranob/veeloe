import { IDLE_ITEMS_MAX, TRIGGER_TEXT_MAX, type IdleProgress, type ListedTrigger, type Trigger } from "@veeloe/protocol-ts";

/** One piece of the list as signed. */
export type Piece = { id: string; text: string; repeat: boolean };

/** The list's own settings: its order and its two times in minutes. */
export type Settings = { order: "ordered" | "oldest-first"; quietMinutes: number; itemMinutes: number };

export type Problem = "empty" | "tooMany";

/** The quiet times and time limits offered, in minutes. */
export const QUIET_CHOICES = [5, 10, 15, 30, 60, 120, 240] as const;
export const ITEM_CHOICES = [5, 10, 15, 30, 60, 120] as const;
/** The shares of the Budget background work may take, in percent. */
export const SHARE_CHOICES = [0, 10, 20, 30, 50, 100] as const;

/** A list's words: an Idle Work list is named by the Agent's model, and this is what it reads. */
const LIST_TEXT = "Idle Work";

/** The pieces still on the list, in the signed order: a one-off piece already done is gone, as `progress` shows. */
export function piecesOf(list: ListedTrigger | undefined): Piece[] {
  const still = list?.progress ? new Set(list.progress.map((p) => p.id)) : null;
  return (list?.idle?.items ?? []).filter((item) => !still || still.has(item.id)).map((item) => ({ id: item.id, text: item.text, repeat: item.repeat ?? false }));
}

export function settingsOf(list: ListedTrigger | undefined): Settings {
  const idle = list?.idle;
  return { order: idle?.order ?? "ordered", quietMinutes: idle?.quietMinutes ?? 15, itemMinutes: idle?.itemMinutes ?? 15 };
}

/** The pieces with `piece` at `position` (0-based), in place of the one with its id or added; past the end means last. */
export function withPiece(pieces: readonly Piece[], piece: Piece, position = pieces.length): Piece[] {
  const others = pieces.filter((one) => one.id !== piece.id);
  const at = Math.max(0, Math.min(position, others.length));
  return [...others.slice(0, at), piece, ...others.slice(at)];
}

/** The Trigger a save signs, or why it cannot be. Its scope is the one the Machine holds now (ADR 0079). */
export function listOf(pieces: readonly Piece[], settings: Settings, id: string, allow: readonly string[] = []): Trigger | Problem {
  const items = pieces.map((piece) => ({ ...piece, text: piece.text.trim() })).filter((piece) => piece.text);
  if (items.length === 0) return "empty";
  if (items.length > IDLE_ITEMS_MAX || items.some((piece) => piece.text.length > TRIGGER_TEXT_MAX)) return "tooMany";
  return {
    id,
    kind: "idle",
    text: LIST_TEXT,
    idle: { items: items.map(({ id: piece, text, repeat }) => ({ id: piece, text, ...(repeat && { repeat }) })), ...settings },
    ...(allow.length > 0 && { allow: [...allow] }),
  };
}

/** Each piece still on the list with its words and where it stands, in the signed order. */
export function progressOf(list: ListedTrigger): (IdleProgress & Piece)[] {
  const items = new Map(piecesOf(list).map((piece) => [piece.id, piece]));
  return (list.progress ?? []).flatMap((progress) => {
    const piece = items.get(progress.id);
    return piece ? [{ ...progress, ...piece }] : [];
  });
}

/** Where a row dragged `dy` points from `from`, past half of each row it crosses. */
export function dropIndex(heights: readonly number[], from: number, dy: number) {
  let to = from;
  let crossed = 0;
  const step = dy > 0 ? 1 : -1;
  for (let i = from + step; i >= 0 && i < heights.length; i += step) {
    if (Math.abs(dy) <= crossed + heights[i] / 2) break;
    crossed += heights[i];
    to = i;
  }
  return to;
}
