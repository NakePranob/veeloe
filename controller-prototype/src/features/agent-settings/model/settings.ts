import { getAgent, getAgents, subscribeAgents, updateAgent } from "../../../entities/agent";
import { checkEntry, getPolicy, hasPolicy, setPolicy } from "../../../entities/agent-policy";
import { can, type Member } from "../../../entities/member";
import { FROZEN_MESSAGE, isFrozen } from "../../../entities/account";
import { authenticate } from "../../../shared/ui";

export type Refusal = string | null;

// When Egress turns per-Agent, every Agent starts with a copy of its Machine's list, so none
// loses a place it could reach (ADR 0029). New Agents get the same.
function seed() {
  for (const agent of getAgents()) if (!hasPolicy(agent.id)) setPolicy(agent.id, { egress: [...agent.machine.egress] });
}
seed();
subscribeAgents(seed);

async function guard(actor: Member, agentId: string, reason: string): Promise<Refusal> {
  const agent = getAgent(agentId);
  if (isFrozen(actor.id)) return FROZEN_MESSAGE;
  if (!agent) return "ไม่พบ Agent";
  if (!can(actor, agentId, "manage")) return `ต้องมี Manage ที่ ${agent.name} ถึงจะแก้ได้`;
  return (await authenticate(reason)) ? null : "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";
}

export async function addEgress(actor: Member, agentId: string, text: string): Promise<Refusal> {
  const checked = checkEntry(text);
  if (!checked.ok) return checked.reason;
  if (getPolicy(agentId).egress.includes(checked.entry)) return `${checked.entry} อยู่ในรายชื่อแล้ว`;
  const refused = await guard(actor, agentId, `เพิ่ม ${checked.entry} ใน Egress ของ ${getAgent(agentId)?.name}`);
  if (refused) return refused;
  setPolicy(agentId, { egress: [...getPolicy(agentId).egress, checked.entry] });
  return null;
}

export async function removeEgress(actor: Member, agentId: string, entry: string): Promise<Refusal> {
  const refused = await guard(actor, agentId, `เอา ${entry} ออกจาก Egress ของ ${getAgent(agentId)?.name}`);
  if (refused) return refused;
  setPolicy(agentId, { egress: getPolicy(agentId).egress.filter((candidate) => candidate !== entry) });
  return null;
}

// A shortcut in the app, not a second list: it copies the entries over and the two stay separate.
export async function copyEgress(actor: Member, toId: string, fromId: string): Promise<Refusal> {
  const from = getAgent(fromId);
  if (!from || from.machineId !== getAgent(toId)?.machineId) return "คัดลอกได้จาก Agent บนเครื่องเดียวกันเท่านั้น";
  const refused = await guard(actor, toId, `คัดลอก Egress จาก ${from.name} มาที่ ${getAgent(toId)?.name}`);
  if (refused) return refused;
  const current = getPolicy(toId).egress;
  setPolicy(toId, { egress: [...current, ...getPolicy(fromId).egress.filter((entry) => !current.includes(entry))] });
  return null;
}

export async function setInternet(actor: Member, agentId: string, on: boolean): Promise<Refusal> {
  const refused = await guard(actor, agentId, on ? `เปิดให้ ${getAgent(agentId)?.name} ออกได้ทั้งเน็ตสาธารณะ` : `ปิดทั้งเน็ตของ ${getAgent(agentId)?.name}`);
  if (refused) return refused;
  setPolicy(agentId, { internet: on });
  return null;
}

// The two search settings of ADR 0060, signed by a Manager and frozen at each Task's start.
export async function setSearch(actor: Member, agentId: string, which: "controller" | "channel", on: boolean): Promise<Refusal> {
  const refused = await guard(actor, agentId, `${on ? "เปิด" : "ปิด"}การค้น Task ${which === "controller" ? "ของคนอื่นในแชต" : "อื่นระหว่างตอบใน Channel"} ของ ${getAgent(agentId)?.name}`);
  if (refused) return refused;
  if (which === "controller") updateAgent(agentId, { searchOtherTasks: on });
  else setPolicy(agentId, { channelSearch: on });
  return null;
}
