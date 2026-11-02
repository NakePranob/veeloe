import { can, type Member } from "../../../entities/member";
import type { Agent } from "../../../entities/agent";

// A Machine's page and logs are for the Owner and for anyone who manages an Agent on it (ADR 0052).
export function canSeeMachine(member: Member, machineId: string, agents: Agent[]) {
  return member.owner || agents.some((agent) => agent.machineId === machineId && can(member, agent.id, "manage"));
}
