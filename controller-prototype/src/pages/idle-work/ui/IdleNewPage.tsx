import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { addAutomation, newId, RULE_LABEL, type IdleItem, type PickRule } from "../../../entities/automation";
import { can, thisDevice, useCurrentMember } from "../../../entities/member";
import { newSignature } from "../../../features/signing";
import { Button, Empty, Field, inform, Note, Row, Screen, Section, Select } from "../../../shared/ui";
import { needsApproval } from "../../../widgets/background-work";
import { proposalFor } from "./proposals";

const DAY = 86_400_000;
const whole = (text: string, fallback: number) => (/^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : fallback);

// The Agent proposes, the Member reads the whole draft and signs once (ADR 0056).
export function IdleNewPage() {
  const { agent: preset } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  const [agentId, setAgentId] = useState(agents.find((agent) => agent.id === preset)?.id ?? agents[0]?.id ?? "");
  const agent = agents.find((candidate) => candidate.id === agentId);
  const [name, setName] = useState("");
  const [items, setItems] = useState<IdleItem[]>([]);
  const [proposed, setProposed] = useState(false);
  const [order, setOrder] = useState<"fixed" | "rule">("fixed");
  const [rule, setRule] = useState<PickRule>("oldest");
  const [quiet, setQuiet] = useState("15");
  const [cap, setCap] = useState("15");
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState("5");
  const device = thisDevice(me);

  if (agents.length === 0) return <Screen title="Idle Work ใหม่"><Empty icon="idle" title="ต้องมี Use ที่ Agent อย่างน้อยหนึ่งตัว" /></Screen>;

  const pickAgent = (id: string) => {
    setAgentId(id);
    setItems([]);
    setProposed(false);
  };

  // ponytail: the proposal appears at once; a real Agent writes it in a Turn and pushes when it is ready.
  const propose = () => {
    const now = Date.now();
    setItems(proposalFor(agentId).map((entry, index) => ({ id: `p${index}`, text: entry.text, since: now - entry.days * DAY, minutes: entry.minutes, status: "todo" as const })));
    setProposed(true);
    if (!name) setName(`งานบ้านของ ${agent?.name}`);
  };

  const addOwn = () => {
    if (!text.trim()) return;
    setItems((current) => [...current, { id: `m${current.length}-${Date.now()}`, text: text.trim(), since: Date.now(), minutes: whole(minutes, 5), status: "todo" }]);
    setText("");
  };

  const save = () => {
    if (!name.trim()) return inform("ยังไม่ได้ตั้งชื่อลิสต์");
    if (items.length === 0) return inform("ลิสต์ยังว่าง", "ให้ Agent เสนอ หรือเพิ่มงานเอง");
    if (!device) return inform("เซ็นไม่ได้", "ไม่มีกุญแจของ Controller เครื่องนี้ที่ใช้ได้");
    const id = newId("idle");
    addAutomation("lists", { id, agent: agentId, name: name.trim(), order, rule, items, quietMinutes: whole(quiet, 15), capMinutes: whole(cap, 15), paused: false, proposedBy: proposed ? "agent" : "member", log: [], ...newSignature() });
    router.replace(`/automation/idle/${id}`);
  };

  const ceiling = agent ? `${agent.backgroundPercent}% ของ Budget ${agent.budget.toLocaleString("en-US")} token ต่อวัน` : "";

  return (
    <Screen title="Idle Work ใหม่" right={{ label: "เซ็นลิสต์", onPress: save }}>
      <Section title="Agent" footer="ลิสต์นี้ทำในนามของคุณ และเรียกใช้ Allowlist กับ Grant เหมือนที่คุณสั่งเอง">
        <Row title="Agent" accessory={<Select label="Agent" value={agentId} options={agents.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={pickAgent} />} />
        <Field label="ชื่อลิสต์" value={name} onChangeText={setName} placeholder={`งานบ้านของ ${agent?.name ?? "Agent"}`} />
      </Section>

      <Section title={proposed ? "ร่างที่ Agent เสนอ" : "งานในลิสต์"} footer={proposed ? "อ่านทุกข้อก่อนเซ็น เอาออกข้อที่ไม่ต้องการได้ คุณเซ็นลิสต์ทั้งก้อนครั้งเดียว หลังจากนั้น Agent ทำตามลิสต์นี้ได้เอง" : "ให้ Agent เสนอจากสิ่งที่เห็นใน Workdir หรือเขียนเอง"}>
        {items.map((item, index) => (
          <Row
            key={item.id}
            title={`${index + 1}. ${item.text}`}
            detail={`ราว ${item.minutes} นาที · รอมา ${Math.max(0, Math.round((Date.now() - item.since) / DAY))} วัน${agent && needsApproval(item, agent.allowlist) ? " · ต้องขอ Approval จะถูกข้ามและแจ้งคุณ" : ""}`}
            icon={agent && needsApproval(item, agent.allowlist) ? "approval" : "list"}
            iconColor={agent && needsApproval(item, agent.allowlist) ? "orange" : undefined}
            accessory={<Button label="เอาออก" onPress={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} />}
          />
        ))}
        {items.length === 0 && <Row title="ยังไม่มีงาน" />}
        <Row icon="agent" title={proposed ? "ให้ Agent เสนอใหม่" : "ให้ Agent เสนอลิสต์"} onPress={propose} />
      </Section>

      <Section title="เพิ่มงานเอง">
        <Field label="งาน" value={text} onChangeText={setText} placeholder="เช่น เช็กลิงก์เสียใน docs/" />
        <Field label="ใช้เวลาราว (นาที) ใช้ในการจำลองเพดานเวลา" value={minutes} onChangeText={setMinutes} keyboardType="numeric" />
        <Row icon="add" title="เพิ่มเข้าลิสต์" onPress={addOwn} />
      </Section>

      <Section title="ลำดับ" footer={order === "rule" ? "Agent เลือกจากงานที่เหลือตามกฎที่คุณเซ็นทุกครั้งที่ตื่น" : "ทำตามลำดับที่เห็นข้างบน"}>
        <Row title="ลำดับ" accessory={<Select label="ลำดับ" value={order} options={[{ value: "fixed", label: "ตายตัว" }, { value: "rule", label: "ตามกฎที่เซ็น" }]} onChange={setOrder} />} />
        {order === "rule" && <Row title="กฎการเลือก" accessory={<Select label="กฎการเลือก" value={rule} options={(Object.keys(RULE_LABEL) as PickRule[]).map((value) => ({ value, label: RULE_LABEL[value] }))} onChange={setRule} />} />}
      </Section>

      <Section title="เวลา" footer="ปลุกก็ต่อเมื่อไม่มี Turn กำลังทำ คิวว่าง และเงียบครบเวลา ข้อความที่เข้ามาระหว่างทำงานต่อคิวตามปกติ ไม่ขัดงานกลางคัน ชิ้นที่เกินเพดานจบเหมือนโดน Stop และถูกทำเครื่องหมายว่าไม่เสร็จ">
        <Field label="เงียบกี่นาทีถึงปลุก" value={quiet} onChangeText={setQuiet} keyboardType="numeric" />
        <Field label="เพดานเวลาต่องานหนึ่งชิ้น (นาที)" value={cap} onChangeText={setCap} keyboardType="numeric" />
      </Section>

      <Section title="สิ่งที่จะเซ็น">
        <Row icon="key" title={`เซ็นในนามของ ${me.name}`} detail={`${items.length} ข้อ · ${order === "fixed" ? "ลำดับตายตัว" : RULE_LABEL[rule]} · เงียบ ${whole(quiet, 15)} นาที · ชิ้นละไม่เกิน ${whole(cap, 15)} นาที`} />
        <Row icon="usage" title="ใช้ token ร่วมกับ Watch ไม่เกินเพดานต่อวัน" detail={ceiling} />
      </Section>
      <Note icon="approval">งานข้อที่ต้องขอ Approval จะถูกจดไว้และข้ามไปข้อถัดไป เพราะตอนนั้นไม่มีคนอยู่ แล้วแจ้งคุณ</Note>
    </Screen>
  );
}
