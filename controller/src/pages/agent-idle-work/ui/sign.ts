import type { ListedTrigger } from "@veeloe/protocol-ts";
import type { Machine } from "../../../entities/machine";
import type { useMachineLink } from "../../../features/machine-link";
import type { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { inform, type Colors } from "../../../shared/ui";
import { listOf, type Piece, type Settings } from "../model/idle";

/** How each piece reads, and the colour of its dot: orange is a person's turn, red did not finish. */
export const STATUS = {
  pending: { words: "status.pending", dot: "tertiaryLabel" },
  working: { words: "status.working", dot: "accent" },
  done: { words: "status.done", dot: "green" },
  timedOut: { words: "status.timedOut", dot: "red" },
  needsApproval: { words: "status.needsApproval", dot: "orange" },
} as const satisfies Record<string, { words: string; dot: keyof Colors }>;

type Where = { link: NonNullable<ReturnType<typeof useMachineLink>>; machine: Machine; agentId: string; agentName: string; t: ReturnType<typeof useT> };

/**
 * Signs the whole list after a fresh authentication (ADR 0012): the Machine holds it as one signed Trigger, so every
 * change to a piece or a setting is the list again. `list` is the one the Machine holds now, so its id and scope stay.
 */
export async function signList({ link, machine, agentId, agentName, t }: Where, list: ListedTrigger | undefined, pieces: readonly Piece[], settings: Settings) {
  const trigger = listOf(pieces, settings, list?.id ?? "idle", list?.allow);
  if (typeof trigger === "string") {
    inform(t(`problem.${trigger}.title`), t(`problem.${trigger}.body`));
    return false;
  }
  const sent = await keySession.signed(t("authenticate.save", { name: agentName }), () => link.changeTrigger(machine, { type: "trigger.set", body: { agent: agentId, trigger } }));
  return sent.status === "sent";
}

/** Deletes the whole list, as removing its last piece does. */
export async function deleteList({ link, machine, agentId, agentName, t }: Where, list: ListedTrigger) {
  const sent = await keySession.signed(t("authenticate.delete", { name: agentName }), () => link.changeTrigger(machine, { type: "trigger.delete", body: { agent: agentId, id: list.id } }));
  return sent.status === "sent";
}
