import type { z } from "zod";
import type { SignedPart } from "../envelope/schema";
import { AgentCreateBodySchema, AgentDeleteBodySchema, AgentListBodySchema, AgentListedBodySchema, AgentRestoreBodySchema, AgentUpdateBodySchema, AgentUsageBodySchema, MachineStatusBodySchema } from "./agent";
import { ApprovalAnswerBodySchema } from "./approval";
import { DirectAnswerBodySchema, DirectCloseBodySchema, DirectOfferBodySchema } from "./direct";
import { EgressSetBodySchema } from "./egress";
import { ErrorBodySchema } from "./error";
import { DeviceHandoffBodySchema, DeviceLinkedBodySchema } from "./linking";
import { MemoryGetBodySchema, MemoryGotBodySchema } from "./memory";
import { PairingClaimBodySchema, PairingDoneBodySchema } from "./pairing-claim";
import { ProviderAddBodySchema } from "./provider";
import { PushRegisterBodySchema, PushRegisteredBodySchema, PushUnregisterBodySchema, PushUnregisteredBodySchema } from "./push";
import { TriggerListBodySchema, TriggerListedBodySchema, TriggerSetBodySchema, TriggerTargetBodySchema } from "./trigger";
import { CardAnswerBodySchema, FileChunkBodySchema, FileGetBodySchema, TaskEventBodySchema, TaskEventsBodySchema, TaskListBodySchema, TaskListedBodySchema, TaskMessageBodySchema, TaskRenameBodySchema, TaskStopBodySchema, TaskSyncBodySchema, ToolOutputBodySchema } from "./task";
import { UsageGetBodySchema, UsageListedBodySchema } from "./usage";

const known = {
  error: ErrorBodySchema,
  "pairing.claim": PairingClaimBodySchema,
  "pairing.done": PairingDoneBodySchema,
  "agent.create": AgentCreateBodySchema,
  "agent.list": AgentListBodySchema,
  "agent.listed": AgentListedBodySchema,
  "agent.update": AgentUpdateBodySchema,
  "agent.delete": AgentDeleteBodySchema,
  "agent.restore": AgentRestoreBodySchema,
  "agent.usage": AgentUsageBodySchema,
  "machine.status": MachineStatusBodySchema,
  "provider.add": ProviderAddBodySchema,
  "approval.answer": ApprovalAnswerBodySchema,
  "task.message": TaskMessageBodySchema,
  "file.chunk": FileChunkBodySchema,
  "file.get": FileGetBodySchema,
  "task.stop": TaskStopBodySchema,
  "card.answer": CardAnswerBodySchema,
  "task.rename": TaskRenameBodySchema,
  "task.event": TaskEventBodySchema,
  "tool.output": ToolOutputBodySchema,
  "task.sync": TaskSyncBodySchema,
  "task.events": TaskEventsBodySchema,
  "egress.set": EgressSetBodySchema,
  "task.list": TaskListBodySchema,
  "task.listed": TaskListedBodySchema,
  "usage.list": UsageGetBodySchema,
  "usage.listed": UsageListedBodySchema,
  "memory.get": MemoryGetBodySchema,
  "memory.got": MemoryGotBodySchema,
  "device.handoff": DeviceHandoffBodySchema,
  "device.linked": DeviceLinkedBodySchema,
  "push.register": PushRegisterBodySchema,
  "push.registered": PushRegisteredBodySchema,
  "push.unregister": PushUnregisterBodySchema,
  "push.unregistered": PushUnregisteredBodySchema,
  "trigger.set": TriggerSetBodySchema,
  "trigger.pause": TriggerTargetBodySchema,
  "trigger.resume": TriggerTargetBodySchema,
  "trigger.delete": TriggerTargetBodySchema,
  "trigger.run": TriggerTargetBodySchema,
  "trigger.list": TriggerListBodySchema,
  "trigger.listed": TriggerListedBodySchema,
  "direct.offer": DirectOfferBodySchema,
  "direct.answer": DirectAnswerBodySchema,
  "direct.close": DirectCloseBodySchema,
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
