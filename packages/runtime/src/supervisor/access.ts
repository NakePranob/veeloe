import type { Agent } from "@veeloe/protocol";

/**
 * Who may change an Agent: Manage (ADR 0059). In v0.1 the only Members in trust
 * are Owners, who Manage every Agent. v0.3 reads Grants here.
 */
export const canManage = (member: string, _agent: Agent, members: string[]) => members.includes(member);
