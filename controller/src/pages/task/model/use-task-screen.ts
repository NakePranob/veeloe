import { useAgents, useTrashedAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useTaskRow } from "../../../entities/task";
import { useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { agentOf } from "./screen";

/** What the Task page shows about who it talks to: the Agent, its Machine and that Machine's state. Null while the lists load. */
export function useTaskScreen(task: string, agentId: string) {
  const t = useT("task");
  const agents = useAgents();
  const trashed = useTrashedAgents();
  const row = useTaskRow(task)?.[0];
  const machines = useMachines();
  const found = agents && trashed ? agentOf(agentId, agents, trashed, row?.machine_id, t("deletedAgent")) : null;
  const machine = machines?.find((m) => m.id === found?.agent.machine_id);
  const status = useMachineStatus(machine?.id ?? "");
  // Until both lists land, neither "an Agent" nor "a deleted Agent" is known yet: showing the deleted state here
  // would flash a wrong name and no composer.
  if (!found || !machines) return null;
  return { ...found, machine, status };
}
