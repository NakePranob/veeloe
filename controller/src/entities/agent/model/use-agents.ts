import { useLiveQuery } from "../../../shared/db";
import { AGENT_TOPIC, LIST_AGENTS, LIST_TRASHED_AGENTS, type AgentRow, type AgentTrashRow } from "./agents";

const TOPICS = [AGENT_TOPIC];

/** Null until the first read lands. */
export function useAgents() {
  return useLiveQuery<AgentRow>(LIST_AGENTS, [], TOPICS);
}

/** The Agents the Machine deleted and can still restore. Null until the first read lands. */
export function useTrashedAgents() {
  return useLiveQuery<AgentTrashRow>(LIST_TRASHED_AGENTS, [], TOPICS);
}
