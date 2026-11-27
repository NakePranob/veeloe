import { useMemo } from "react";
import { headsOf, useThreadHeads } from "../../../entities/task";

/**
 * The newest round of each of this Agent's Triggers that this device holds a Task of, by Trigger id.
 * No thread is hidden here: deleting a thread only tidies the Agent page.
 */
export function useLastRounds(agentId: string, online: boolean | null) {
  const heads = useThreadHeads(agentId, false);
  return useMemo(() => new Map(headsOf(heads ?? [], online).map((head) => [head.id, head.round])), [heads, online]);
}
