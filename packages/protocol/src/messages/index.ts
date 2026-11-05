import type { z } from "zod";
import type { SignedPart } from "../envelope/schema";
import { AgentCreateBodySchema, AgentListBodySchema, AgentListedBodySchema, AgentUpdateBodySchema } from "./agent";
import { EgressSetBodySchema } from "./egress";
import { ErrorBodySchema } from "./error";
import { DeviceHandoffBodySchema, DeviceLinkedBodySchema } from "./linking";
import { PairingClaimBodySchema, PairingDoneBodySchema } from "./pairing-claim";
import { TaskEventBodySchema, TaskEventsBodySchema, TaskListBodySchema, TaskListedBodySchema, TaskMessageBodySchema, TaskSyncBodySchema } from "./task";

const known = {
  error: ErrorBodySchema,
  "pairing.claim": PairingClaimBodySchema,
  "pairing.done": PairingDoneBodySchema,
  "agent.create": AgentCreateBodySchema,
  "agent.list": AgentListBodySchema,
  "agent.listed": AgentListedBodySchema,
  "agent.update": AgentUpdateBodySchema,
  "task.message": TaskMessageBodySchema,
  "task.event": TaskEventBodySchema,
  "task.sync": TaskSyncBodySchema,
  "task.events": TaskEventsBodySchema,
  "egress.set": EgressSetBodySchema,
  "task.list": TaskListBodySchema,
  "task.listed": TaskListedBodySchema,
  "device.handoff": DeviceHandoffBodySchema,
  "device.linked": DeviceLinkedBodySchema,
};

type KnownType = keyof typeof known;
export type KnownMessage = { [T in KnownType]: { type: T; body: z.infer<(typeof known)[T]> } }[KnownType];

export type ParsedMessage =
  | { kind: "message"; message: KnownMessage }
  /** A type this build does not know: skip it, never fail on it (ADR 0023). */
  | { kind: "unknown"; type: string }
  | { kind: "invalid" };

/** Reads the body of an envelope that `verify` has already accepted. */
export function parseMessage({ type, body }: Pick<SignedPart, "type" | "body">): ParsedMessage {
  if (!Object.hasOwn(known, type)) return { kind: "unknown", type };
  const parsed = known[type as KnownType].safeParse(body);
  return parsed.success ? { kind: "message", message: { type, body: parsed.data } as KnownMessage } : { kind: "invalid" };
}
