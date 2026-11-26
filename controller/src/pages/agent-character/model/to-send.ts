import type { AgentUpdateBody } from "@veeloe/protocol-ts";
import type { Look } from "../../../entities/character";

type Sent = NonNullable<AgentUpdateBody["character"]>;

/**
 * What Done sends: the Character the Machine keeps, as it came, with only the slots the Owner
 * touched changed. A part this build does not know was drawn as the first of its slot, so sending
 * the draft whole would wipe what a newer Controller picked (ADR 0023). An Agent with no Character
 * yet gets the whole draft.
 */
export function characterToSend(stored: string | null, draft: Look, touched: ReadonlySet<keyof Look>): Sent {
  let kept: unknown = null;
  try {
    kept = stored ? JSON.parse(stored) : null;
  } catch {
    // A row that does not parse is the same as none.
  }
  if (!kept || typeof kept !== "object") return { ...draft };
  return { ...(kept as Sent), ...Object.fromEntries([...touched].map((slot) => [slot, draft[slot]])) };
}
