import { getAgent, getAgents } from "../../../entities/agent";
import { channelsOf } from "../../../entities/channel";
import { can, type Member } from "../../../entities/member";
import { doerAgents, findCycle, getProjects, getTeam, getTeams, projectAgents, type Doer, type Team } from "../../../entities/project";

// Who may put which Agent in a Project or a Team, and which Agent may take a Channel. Each answer
// is the reason in words, or null when it is allowed, so a screen can show it beside the control.

// Anyone with Manage on at least one Agent creates a Project and holds Manage of it (ADR 0046).
export function canCreateProject(member: Member | undefined) {
  return getAgents().some((agent) => can(member, agent.id, "manage"));
}

// The same bar starts a Team (ADR 0064).
export const canCreateTeam = canCreateProject;

// The cap and deleting the Team belong to whoever looks after its Entry (ADR 0064).
export function canManageTeam(member: Member | undefined, team: Pick<Team, "entry">) {
  return can(member, team.entry, "manage");
}

// Joining a Team, or becoming its Entry, needs Manage on that Agent: the people who look after it
// agree to take work in every Project the Team is in (ADR 0010, 0064).
export function whyNotEmployee(member: Member | undefined, agentId: string, machineId: string): string | null {
  const agent = getAgent(agentId);
  if (!agent) return "ไม่พบ Agent";
  if (agent.machineId !== machineId) return `อยู่บน ${agent.machine.name} คนละ Machine`;
  if (!can(member, agentId, "manage")) return "ต้องมี Manage ที่ Agent นี้";
  if (channelsOf(agentId).length) return "มี Channel อยู่ เข้า Project หรือ Team ไม่ได้ (ADR 0028)";
  return null;
}

// Onto a Project's list: Manage on the Agent, or on every Agent of the Team. Without it a Project
// would be a shortcut to Agents its people hold no right on (ADR 0010, 0064). The page checks Manage of the Project.
export function whyNotDoer(member: Member | undefined, doer: Doer, machineId: string): string | null {
  if (doer.kind === "team" && !getTeam(doer.id)) return "ไม่พบ Team";
  for (const agentId of doerAgents(doer)) {
    const why = whyNotEmployee(member, agentId, machineId);
    if (why) return doer.kind === "team" ? `${getAgent(agentId)?.name ?? agentId}: ${why}` : why;
  }
  return null;
}

// Delegation across every Team on a Machine must not loop (ADR 0045). `next` is the Team
// as it would be after the change.
export function whyCycle(next: Pick<Team, "id" | "name" | "machineId" | "entry" | "employees">): string | null {
  const others = getTeams().filter((team) => team.id !== next.id);
  const cycle = findCycle([...others, next as Team], next.machineId);
  if (!cycle) return null;
  const names = cycle.path.map((id) => getAgent(id)?.name ?? id).join(" → ");
  return `ส่งงานเป็นวง ${names} (เกิดจาก Team ${cycle.teams.map((name) => `"${name}"`).join(" กับ ")}) ทั้งสองจะถือ Turn รอกันตลอด`;
}

// An Agent that works in a Project or a Team cannot take a Channel, the other direction of the same rule.
export function whyNotChannel(agentId: string): string | null {
  const team = getTeams().find((candidate) => candidate.employees.includes(agentId));
  if (team) return `เป็นพนักงานของ Team "${team.name}" ผูก Channel ไม่ได้ (ADR 0028)`;
  const project = getProjects().find((candidate) => projectAgents(candidate).includes(agentId));
  return project ? `เป็นผู้ทำงานของ Project "${project.name}" ผูก Channel ไม่ได้ (ADR 0028)` : null;
}
