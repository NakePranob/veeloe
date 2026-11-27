import type { ListedTrigger } from "@veeloe/protocol-ts";
import { useEffect, useMemo } from "react";
import { missingParts } from "../../../entities/agent";
import type { Machine } from "../../../entities/machine";
import { originOf } from "../../../entities/task";
import { useMachineLink, useTriggerStatus, withScope } from "../../../features/machine-link";

/** The entries a command still needs before this Schedule's rounds may run it without asking (ADR 0079). */
// ponytail: each missing part goes in whole, the narrowest entry that covers it; let the Member trim it as "allow always" does if that proves too tight.
export const scopeNeeds = (command: string, allowlist: readonly string[], trigger: Pick<ListedTrigger, "allow">) => missingParts(command, [...allowlist, ...(trigger.allow ?? [])]);

/**
 * The Schedule a Task is a round of, while it still runs (not deleted, not suspended), and a way to widen
 * what its rounds may do. Asks the Machine for the Agent's Triggers when the Task opens.
 */
export function useScheduleScope(events: readonly { kind: string; body: string }[] | null, machine: Machine | undefined, agentId: string, online: boolean | null) {
  const link = useMachineLink();
  const first = events?.find((event) => event.kind === "member.message")?.body ?? null;
  const origin = useMemo(() => originOf({ first_body: first }), [first]);
  const status = useTriggerStatus(machine?.id ?? "", agentId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (origin?.kind === "schedule" && link && machine && online !== false) link.requestTriggers(machine, agentId);
  }, [origin?.id, link, machine?.id, agentId, online]);
  const trigger = origin ? status.triggers?.find((held) => held.id === origin.id && !held.suspended) : undefined;
  return {
    trigger,
    /** A change is on its way: the next one would be built on the scope before it, and drop what it added. */
    sending: status.sending,
    /** Signs the Schedule again with these entries added; the sig, or null when nothing went. */
    add: (entries: readonly string[]) => (trigger && link && machine ? link.changeTrigger(machine, { type: "trigger.set", body: { agent: agentId, trigger: withScope(trigger, [...(trigger.allow ?? []), ...entries]) } }) : null),
  };
}
