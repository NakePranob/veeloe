type Level = "use" | "approve" | "manage";
const RANK: Record<Level, number> = { use: 1, approve: 2, manage: 3 };

/**
 * What the groups someone is in give them at one Agent (ADR 0091): the highest level, and the group it comes from.
 * The Runtime takes the higher of this and their own Grant, so the person page says where a level comes from (ADR 0093).
 */
export function fromGroups(groups: readonly { name: string; members: readonly string[]; grants: readonly { agent: string; level: Level }[] }[], member: string, agent: string): { level: Level; group: string } | null {
  let best: { level: Level; group: string } | null = null;
  for (const group of groups) {
    if (!group.members.includes(member)) continue;
    const level = group.grants.find((grant) => grant.agent === agent)?.level;
    if (level && (!best || RANK[level] > RANK[best.level])) best = { level, group: group.name };
  }
  return best;
}
