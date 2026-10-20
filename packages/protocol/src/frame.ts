import type { z } from "zod";
import { HubAuthSchema } from "./messages/hub-auth";
import { HubChallengeSchema } from "./messages/hub-challenge";
import { HubReadySchema } from "./messages/hub-ready";

const known = {
  "hub.challenge": HubChallengeSchema,
  "hub.auth": HubAuthSchema,
  "hub.ready": HubReadySchema,
};

type KnownType = keyof typeof known;
export type KnownMessage = { [T in KnownType]: z.infer<(typeof known)[T]> }[KnownType];

export type Frame =
  | { kind: "message"; message: KnownMessage }
  /** A type this build does not know: skip it, never fail on it (ADR 0023). */
  | { kind: "unknown"; type: string }
  | { kind: "invalid" };

export function parseFrame(text: string): Frame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
    return { kind: "invalid" };
  }
  const type = (value as { type: string }).type;
  if (!Object.hasOwn(known, type)) return { kind: "unknown", type };
  const parsed = known[type as KnownType].safeParse(value);
  return parsed.success ? { kind: "message", message: parsed.data as KnownMessage } : { kind: "invalid" };
}
