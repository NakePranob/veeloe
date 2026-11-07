import type { Agent } from "@veeloe/protocol";

/**
 * Who may change an Agent: Manage (ADR 0059). In v0.1 the only Members in trust
 * are Owners, who Manage every Agent. v0.3 reads Grants here.
 */
export const canManage = (member: string, _agent: Agent, members: string[]) => members.includes(member);

/**
 * Who may answer an Approval: Approve at that Agent (CONTEXT.md). In v0.1 the
 * only Members in trust are Owners, who may Approve every Agent. v0.3 reads Grants here.
 */
export const canApprove = (member: string, _agent: Agent, members: string[]) => members.includes(member);

/**
 * Who may use an Agent, and so stop any of its Turns: Use (ADR 0017). In v0.1 the
 * only Members in trust are Owners. v0.3 reads Grants here.
 */
export const canUse = (member: string, _agent: Agent, members: string[]) => members.includes(member);
