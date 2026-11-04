import { useLiveQuery } from "../../../shared/db";
import { AGENT_TOPIC, LIST_AGENTS, type AgentRow } from "./agents";

const TOPICS = [AGENT_TOPIC];

/** Null until the first read lands. */
export function useAgents() {
  return useLiveQuery<AgentRow>(LIST_AGENTS, [], TOPICS);
}
