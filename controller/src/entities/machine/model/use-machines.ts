import { useLiveQuery } from "../../../shared/db";
import { LIST_MACHINES, MACHINE_TOPIC, type Machine } from "./machines";

const TOPICS = [MACHINE_TOPIC];

/** Null until the first read lands. */
export function useMachines() {
  return useLiveQuery<Machine>(LIST_MACHINES, [], TOPICS);
}
