import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Character, deleteAgent, updateAgent, useAgent, useAgents, type Agent } from "../../../entities/agent";
import { can, setGrant, useCurrentMember, useMembers, type Member } from "../../../entities/member";
import { deleteTasksOf, getTasks, lastActivity, STATUS_LABEL, statusOf, useTasks } from "../../../entities/task";
import { canRead } from "../../../features/access";
import { budgetChanged, newTask, stopTurn } from "../../../features/demo-runtime";
import { ago, formatTokens, useNow } from "../../../shared/lib";
import { Button, confirm, Empty, Field, Icon, inform, Meter, Note, Row, Screen, Section, Select, space, Text } from "../../../shared/ui";
import { requireOnline } from "../model/guard";

const CAPS = [0, 10, 20, 30, 50, 70, 100];
const EXPIRIES = [15, 30, 60, 240, 1440];
const minutes = (value: number) => (value >= 60 ? `${value / 60} ชั่วโมง` : `${value} นาที`);

export function AgentPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  const me = useCurrentMember();
  if (!agent || !can(me, agent.id, "use")) {
    return (
      <Screen title="Agent">
        <Empty icon="agent" title="ไม่พบ Agent นี้" detail="Agent อาจถูกลบแล้ว หรือคุณยังไม่มี Grant ของ Agent นี้" />
      </Screen>
    );
  }
  return <AgentView agent={agent} me={me} />;
}

function AgentView({ agent, me }: { agent: Agent; me: Member }) {
  const members = useMembers();
  const others = useAgents();
  const now = useNow();
  const manage = can(me, agent.id, "manage");
  const tasks = useTasks()
    .filter((task) => task.agent === agent.id && !task.team && canRead(me, task))
    .sort((a, b) => lastActivity(b.events) - lastActivity(a.events));
  const [draft, setDraft] = useState({ name: agent.name, description: agent.description, instructions: agent.instructions });
  const [budget, setBudget] = useState(String(agent.budget / 1_000_000));
  const provider = agent.machine.providers.find((candidate) => candidate.id === agent.providerId);
  const dirty = draft.name !== agent.name || draft.description !== agent.description || draft.instructions !== agent.instructions;
  const share = agent.usedToday / agent.budget;

  function save() {
    const name = draft.name.trim();
    if (!name) return inform("บันทึกไม่ได้", "Agent ต้องมีชื่อ");
    if (others.some((other) => other.id !== agent.id && other.name.toLowerCase() === name.toLowerCase())) return inform("บันทึกไม่ได้", `มี Agent ชื่อ ${name} แล้ว`);
    updateAgent(agent.id, { name, description: draft.description.trim(), instructions: draft.instructions.trim() });
  }

  function chooseProvider(providerId: string) {
    if (!requireOnline(agent.machine)) return;
    updateAgent(agent.id, { providerId, model: agent.machine.providers.find((candidate) => candidate.id === providerId)?.models[0] ?? agent.model });
  }

  function saveBudget() {
    const tokens = Math.round(Number(budget) * 1_000_000);
    if (!(tokens > 0)) return inform("Budget ไม่ถูกต้อง", "ใส่จำนวนล้าน token ต่อวันที่มากกว่า 0");
    if (!requireOnline(agent.machine)) return;
    updateAgent(agent.id, { budget: tokens });
    // Raising it lets Tasks that stopped at the limit carry on and the queue move.
    if (tokens > agent.budget) budgetChanged(agent.id);
  }

  function setNumber(patch: "backgroundPercent" | "approvalMinutes", value: string) {
    if (requireOnline(agent.machine)) updateAgent(agent.id, { [patch]: Number(value) });
  }

  function start() {
    router.push(`/tasks/${newTask(agent.id).id}`);
  }

  async function remove() {
    if (!requireOnline(agent.machine)) return;
    const yes = await confirm({
      title: `ลบ ${agent.name}?`,
      message: `Agent กับ Task ทั้งหมดของมันจะหายจากแอปและกู้คืนไม่ได้ แต่โฟลเดอร์ ~/.veeloe/agents/${agent.id}/ บน ${agent.machine.name} (Workdir, Memory, ประวัติ Task) ยังอยู่บนดิสก์จนเจ้าของเครื่องลบเอง และ Agent ตัวอื่นอ่านไม่ได้ (ADR 0032)`,
      action: "ลบ Agent",
      destructive: true,
    });
    if (!yes) return;
    for (const task of getTasks().filter((candidate) => candidate.agent === agent.id)) stopTurn(task.id);
    deleteTasksOf(agent.id);
    members.forEach((member) => setGrant(member.id, agent.id, null));
    deleteAgent(agent.id);
    router.replace("/agents");
  }

  return (
    <Screen title={agent.name} right={manage ? { label: "บันทึก", onPress: save, disabled: !dirty } : undefined}>
      <View style={{ alignItems: "center", gap: space.xs }}>
        <Character look={agent.character} mood={agent.machine.online ? "idle" : "offline"} size={96} />
        <Text variant="footnote" tone="secondary">
          {agent.machine.name} · {agent.machine.online ? "ออนไลน์" : "ออฟไลน์"}
        </Text>
      </View>
      {!agent.machine.online && <Note icon="info" iconColor="orange">Machine ออฟไลน์ ชื่อ คำอธิบายและคำสั่งที่แก้ตอนนี้รอในคิวขาออกของเครื่องนี้ ส่วนค่าอื่นแก้ได้เมื่อเครื่องกลับมา (ADR 0006)</Note>}
      {!manage && <Note icon="lock">คุณมี Use ที่ Agent นี้ ค่าด้านล่างแก้ได้เฉพาะคนที่มี Manage</Note>}

      <Section title="Task" footer="แสดงเฉพาะ Task ที่คุณเริ่ม หรือที่คนเริ่มเปิดให้คนที่มี Use เห็น (ADR 0060)">
        <Row icon="add" title="Task ใหม่" onPress={start} />
        {tasks.map((task) => (
          <Row key={task.id} icon="thread" title={task.title} detail={task.events.length ? STATUS_LABEL[statusOf(task.events, agent.machine.online, now)] : "ยังไม่ได้เริ่ม"} value={ago(lastActivity(task.events), now)} href={`/tasks/${task.id}`} />
        ))}
      </Section>

      <Section title="Agent">
        {manage && <Row icon="agent" title="Character" detail="หน้าตาและท่าทางที่แสดงใน Inbox" href={`/agents/${agent.id}/character`} />}
        {manage ? (
          <>
            <Field label="ชื่อ" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <Field label="คำอธิบาย" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} />
            <Field label="คำสั่งของ Agent" value={draft.instructions} onChangeText={(instructions) => setDraft({ ...draft, instructions })} multiline footer="คำสั่งนี้เป็นค่าที่ Member เซ็น Agent แก้เองไม่ได้ (ADR 0038)" />
          </>
        ) : (
          <>
            <Row title="ชื่อ" value={agent.name} />
            <Row title="คำอธิบาย" detail={agent.description} />
            <Row title="คำสั่งของ Agent" detail={agent.instructions} />
          </>
        )}
      </Section>

      <Section title="Provider และ model" footer="เปลี่ยนแล้วมีผลตั้งแต่ Task ถัดไป Task ที่กำลังทำอยู่ใช้ model เดิมจนจบ เพราะเปลี่ยนกลาง Task ทำให้ prompt cache เริ่มใหม่ และ thinking ใช้ต่อไม่ได้ ถ้า Provider ล่ม Agent ทุกตัวบนเครื่องที่ใช้ตัวนั้นหยุดพร้อมกัน (ADR 0042)">
        {manage ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, padding: space.sm }}>
            <Select label="Provider" value={agent.providerId} options={agent.machine.providers.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={chooseProvider} />
            <Select
              label="model"
              value={agent.model}
              options={(provider?.models.includes(agent.model) ? provider.models : [agent.model, ...(provider?.models ?? [])]).map((model) => ({ value: model, label: model }))}
              onChange={(model) => requireOnline(agent.machine) && updateAgent(agent.id, { model })}
            />
          </View>
        ) : (
          <>
            <Row icon="key" title="Provider" value={provider?.name ?? agent.providerId} />
            <Row title="model" value={agent.model} mono />
          </>
        )}
        {provider && <Row title="context ของ model" value={`${formatTokens(provider.contextSize)} token`} />}
      </Section>

      <Section title="Budget วันนี้" footer="นับทุก token ที่ Provider รายงาน วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine พอหมด Turn ที่ทำอยู่จบเหมือนโดน Stop และงานใหม่ไม่เริ่มจนขึ้นวันใหม่หรือมีคนเพิ่ม ควรตั้ง spend limit ที่ Provider ไว้อีกชั้นด้วย (ADR 0043)">
        <View style={{ gap: space.sm, padding: space.sm }}>
          <Meter value={share} label="Budget วันนี้" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {share >= 0.8 && <Icon name="info" size="sm" color={share >= 1 ? "red" : "orange"} />}
            <Text variant="footnote" tone="secondary">
              {formatTokens(agent.usedToday)} จาก {formatTokens(agent.budget)} token ({Math.round(share * 100)}%){share >= 1 ? " · หมดแล้ว" : ""}
            </Text>
          </View>
        </View>
        {manage ? (
          <>
            <Field label="Budget ต่อวัน (ล้าน token)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
            <View style={{ alignItems: "flex-start", padding: space.sm }}>
              <Button label="ตั้ง Budget" disabled={Math.round(Number(budget) * 1_000_000) === agent.budget} onPress={saveBudget} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm }}>
              <Text style={{ flex: 1 }}>Idle Work และ Watch ใช้ได้ไม่เกิน</Text>
              <Select label="เพดาน Idle Work และ Watch" value={String(agent.backgroundPercent)} options={(CAPS.includes(agent.backgroundPercent) ? CAPS : [...CAPS, agent.backgroundPercent].sort((a, b) => a - b)).map((cap) => ({ value: String(cap), label: `${cap}%` }))} onChange={(value) => setNumber("backgroundPercent", value)} />
            </View>
          </>
        ) : (
          <Row title="Idle Work และ Watch ใช้ได้ไม่เกิน" value={`${agent.backgroundPercent}% ของ Budget`} />
        )}
        {manage && <Note>เพดานนี้คือส่วนของ Budget ที่ Idle Work กับ Watch ใช้รวมกันได้ ถึงเพดานแล้วงานชิ้นที่ทำอยู่จบ แต่งานที่คนสั่งยังทำต่อได้ (ADR 0056)</Note>}
      </Section>

      <Section title="Approval" footer="Approval ที่ไม่มีใครตอบจนเกินเวลานี้นับว่าถูกปฏิเสธ (ADR 0003)">
        {manage ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm }}>
            <Text style={{ flex: 1 }}>Approval หมดอายุใน</Text>
            <Select label="Approval หมดอายุใน" value={String(agent.approvalMinutes)} options={(EXPIRIES.includes(agent.approvalMinutes) ? EXPIRIES : [...EXPIRIES, agent.approvalMinutes].sort((a, b) => a - b)).map((value) => ({ value: String(value), label: minutes(value) }))} onChange={(value) => setNumber("approvalMinutes", value)} />
          </View>
        ) : (
          <Row title="Approval หมดอายุใน" value={minutes(agent.approvalMinutes)} />
        )}
      </Section>

      <Section title="ตั้งค่าเพิ่มเติม">
        <Row icon="shield" title="Allowlist" value={`${agent.allowlist.length} รายการ`} href={`/agents/${agent.id}/allowlist`} />
        <Row icon="file" title="Memory" value={`${agent.memory.length.toLocaleString()} / 4,000`} href={`/agents/${agent.id}/memory`} />
        {manage && <Row icon="skill" title="Skill" href={`/agents/${agent.id}/skills`} />}
        {manage && <Row icon="members" title="สิทธิ์เข้าถึง" href={`/agents/${agent.id}/access`} />}
        {manage && <Row icon="network" title="Egress" href={`/agents/${agent.id}/egress`} />}
        <Row icon="network" title="เว็บ (web_search และ web_fetch)" href={`/agents/${agent.id}/web`} />
        <Row icon="connector" title="Connector" href={`/connectors?agent=${agent.id}`} />
        <Row icon="channel" title="Channel" href={`/channels?agent=${agent.id}`} />
        <Row icon="schedule" title="Schedule, Idle Work และ Watch" href={`/automation?agent=${agent.id}`} />
      </Section>

      {manage && (
        <Section title="ลบ Agent" footer={`Agent กับ Task ของมันหายจากแอป แต่ไฟล์ไม่หาย โฟลเดอร์ ~/.veeloe/agents/${agent.id}/ บน ${agent.machine.name} อยู่บนดิสก์จนเจ้าของเครื่องลบเอง เพราะเป็นข้อมูลของลูกค้า Agent ตัวอื่นอ่านไม่ได้ (ADR 0032)`}>
          <Row icon="trash" title={`ลบ ${agent.name}`} destructive onPress={remove} />
        </Section>
      )}
    </Screen>
  );
}
