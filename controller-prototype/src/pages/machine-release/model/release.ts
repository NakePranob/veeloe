import { getAgents, removeMachine, type Machine } from "../../../entities/agent";
import { FROZEN_MESSAGE, isFrozen } from "../../../entities/account";
import { getAutomation, removeAutomation } from "../../../entities/automation";
import { deleteChannel, getChannels } from "../../../entities/channel";
import { getConnectors, removeConnector } from "../../../entities/connector";
import { getMembers, setGrant, type Member } from "../../../entities/member";
import { deleteTasksOf, getTasks } from "../../../entities/task";
import { dropRelease, getRelease, patchRelease, recordMoved, signRelease } from "../../../entities/release";
import { setMachineOnline } from "../../../features/demo-runtime";
import { authenticate } from "../../../shared/ui";

type Refusal = string | null;
const CANCELLED = "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";

// What leaves with the Machine, as the Owner sees it before signing and after (ADR 0035).
export function moveSummary(machine: Machine) {
  const agents = getAgents().filter((agent) => agent.machineId === machine.id);
  const ids = agents.map((agent) => agent.id);
  return {
    agents,
    tasks: getTasks().filter((task) => ids.includes(task.agent)).length,
    grants: getMembers().reduce((sum, member) => sum + ids.filter((id) => member.grants[id]).length, 0),
  };
}

export async function release(me: Member, machine: Machine): Promise<Refusal> {
  if (!me.owner) return "เฉพาะ Owner ที่ปล่อย Machine ได้";
  if (isFrozen(me.id)) return FROZEN_MESSAGE;
  if (!(await authenticate(`เซ็นปล่อย ${machine.name} ให้ Pairing กับ Workspace ใหม่`))) return CANCELLED;
  signRelease(machine.id, machine.name, me.id);
  return null;
}

// Any Owner of this Workspace can cancel. A Machine that is off gets the command when it is back (ADR 0035).
export async function cancelRelease(me: Member, machine: Machine): Promise<Refusal> {
  if (!me.owner) return "เฉพาะ Owner ที่ยกเลิกการปล่อยได้";
  if (!(await authenticate(`ยกเลิกการปล่อย ${machine.name}`))) return CANCELLED;
  if (machine.online) dropRelease(machine.id);
  else patchRelease(machine.id, { cancelPending: true });
  return null;
}

// ponytail: the new Workspace's Owner pairs at the Machine and the Hub moves it. Here that takes
// the Machine out of this Workspace; a reload brings the Demo Workspace back.
export async function pairElsewhere(me: Member, machine: Machine): Promise<Refusal> {
  const found = getRelease(machine.id);
  if (!found) return "Machine นี้ไม่ได้ถูกปล่อย Pairing กับ Workspace ใหม่จึงเริ่มจากศูนย์ ไม่มีอะไรตามไป";
  if (Date.now() >= found.expiresAt) return "คำสั่งปล่อยหมดอายุแล้ว (7 วัน) ต้องเซ็นใหม่";
  if (!(await authenticate("Pairing Machine นี้กับ Workspace ใหม่ (ฝั่ง Owner ใหม่)"))) return CANCELLED;
  const { agents, tasks, grants } = moveSummary(machine);
  recordMoved({ machineId: machine.id, machineName: machine.name, at: Date.now(), agents: agents.map((agent) => agent.name), tasks, grants });
  for (const agent of agents) {
    // Grants name Members of the old Workspace, so none of them survives.
    for (const member of getMembers()) if (member.grants[agent.id]) setGrant(member.id, agent.id, null);
    deleteTasksOf(agent.id);
    // Schedules and Channels stop, Connector credentials are wiped (ADR 0035). The Agents leave with the Machine.
    const { schedules, lists, watches } = getAutomation();
    schedules.filter((item) => item.agent === agent.id).forEach((item) => removeAutomation("schedules", item.id));
    lists.filter((item) => item.agent === agent.id).forEach((item) => removeAutomation("lists", item.id));
    watches.filter((item) => item.agent === agent.id).forEach((item) => removeAutomation("watches", item.id));
    getChannels().filter((item) => item.agent === agent.id).forEach((item) => deleteChannel(item.id));
    getConnectors().filter((item) => item.agent === agent.id).forEach((item) => removeConnector(item.id));
  }
  setMachineOnline(machine.id, false);
  removeMachine(machine.id);
  dropRelease(machine.id);
  void me;
  return null;
}

export function expireRelease(machineId: string) {
  patchRelease(machineId, { expiresAt: Date.now() - 1 });
}
