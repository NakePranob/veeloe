import { ALLOWLIST_MAX, type ListedTrigger, type Trigger } from "@veeloe/protocol-ts";

/**
 * The Trigger to sign again with a new scope (ADR 0079): the same id, words and times, so the Machine keeps
 * its rounds, and `allow` replaced whole. Duplicates go, and the Protocol's cap holds.
 */
export function withScope(trigger: ListedTrigger, allow: readonly string[]): Trigger {
  const scope = [...new Set(allow.map((entry) => entry.trim()).filter(Boolean))].slice(0, ALLOWLIST_MAX);
  return {
    id: trigger.id,
    kind: trigger.kind,
    text: trigger.text,
    schedule: trigger.schedule,
    ...(trigger.notify && { notify: trigger.notify }),
    ...(scope.length > 0 && { allow: scope }),
  };
}
