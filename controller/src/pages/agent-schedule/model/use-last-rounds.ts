import { useMemo } from "react";
import { threadsOf, useTaskSummaries } from "../../../entities/task";

/** No thread is hidden from a Schedule's own page: deleting a thread only tidies the Agent page. */
const NONE_HIDDEN: ReadonlySet<string> = new Set();

/** The newest round of each of this Agent's Triggers that this device holds a Task of, by Trigger id. */
export function useLastRounds(agentId: string, online: boolean | null) {
  const summaries = useTaskSummaries();
  return useMemo(() => new Map(threadsOf(summaries ?? [], agentId, NONE_HIDDEN, online).map((thread) => [thread.id, thread.rounds[0]])), [summaries, agentId, online]);
}
