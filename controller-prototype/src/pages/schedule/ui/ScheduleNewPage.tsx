import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { addAutomation, CADENCES, newId } from "../../../entities/automation";
import { can, thisDevice, useCurrentMember } from "../../../entities/member";
import { newSignature } from "../../../features/signing";
import { Empty, Field, inform, Note, Row, Screen, Section, Select } from "../../../shared/ui";

// A Schedule is signed when it is saved: the message, the time and who hears about it are what
// the Member signs (ADR 0006, 0027).
export function ScheduleNewPage() {
  const { agent: preset } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  const [agentId, setAgentId] = useState(agents.find((agent) => agent.id === preset)?.id ?? agents[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [cadence, setCadence] = useState(CADENCES[2].value);
  const [notify, setNotify] = useState<"setter" | "everyone">("setter");
  const agent = agents.find((candidate) => candidate.id === agentId);
  const device = thisDevice(me);

  if (agents.length === 0) return <Screen title="Schedule ใหม่"><Empty icon="schedule" title="ต้องมี Use ที่ Agent อย่างน้อยหนึ่งตัว" /></Screen>;

  const save = () => {
    if (!message.trim()) return inform("ยังไม่ได้ใส่ข้อความ", "Schedule คือข้อความที่ Agent จะได้รับทุกรอบ");
    if (!device) return inform("เซ็นไม่ได้", "ไม่มีกุญแจของ Controller เครื่องนี้ที่ใช้ได้");
    const id = newId("sch");
    addAutomation("schedules", { id, agent: agentId, message: message.trim(), cadence, notify, paused: false, log: [], ...newSignature() });
    router.replace(`/automation/schedules/${id}`);
  };

  return (
    <Screen title="Schedule ใหม่" right={{ label: "เซ็นและบันทึก", onPress: save }}>
      <Section title="ข้อความ" footer="Agent ได้ข้อความนี้เป็น Task ใหม่ทุกรอบ ความต่อเนื่องข้ามรอบ เช่นเรื่องที่แจ้งไปแล้ว Agent จดลงไฟล์ใน Workdir เอง">
        <Field label="บอก Agent ว่าให้ทำอะไรทุกรอบ" value={message} onChangeText={setMessage} multiline placeholder="เช่น ไล่ดู PR ที่ค้างรีวิว ถ้าไม่มีอะไรให้เงียบ" />
      </Section>
      <Section title="ตั้งค่า">
        <Row title="Agent" accessory={<Select label="Agent" value={agentId} options={agents.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={setAgentId} />} />
        <Row title="ความถี่" accessory={<Select label="ความถี่" value={cadence} options={CADENCES.map((item) => ({ value: item.value, label: item.label }))} onChange={setCadence} />} />
        <Row
          title="ใครได้ยินเรื่องที่ Agent บอก"
          detail={notify === "everyone" ? "push ไปหาทุกคนที่มี Use ที่ Agent นี้ และ Task ของรอบนั้นเปิดให้พวกเขาเห็น" : "push ไปหาคุณคนเดียว"}
          accessory={<Select label="ผู้รับ" value={notify} options={[{ value: "setter", label: "แค่ฉัน" }, { value: "everyone", label: "ทุกคนที่มี Use" }]} onChange={setNotify} />}
        />
      </Section>
      <Section title="สิ่งที่จะเซ็น" footer="ถ้าไม่มีอะไรต้องบอก Agent จบ Turn แบบเงียบ Task ของรอบนั้นไม่ขึ้น Inbox ถ้าถึงรอบแล้ว Agent ยังไม่ว่าง รอบนั้นถูกข้ามไป ไม่ต่อคิว">
        <Row icon="key" title={`เซ็นในนามของ ${me.name}`} detail={`ด้วยกุญแจ ${device?.name ?? "—"} งานทำในนามของคุณ และ Grant กับ Approval ทำงานเหมือนที่คุณสั่งเอง`} />
        {agent && <Row icon="agent" title={agent.name} detail={`${CADENCES.find((item) => item.value === cadence)?.label} · Machine ${agent.machine.name}`} />}
      </Section>
      <Note icon="lock">Schedule หยุดทันทีเมื่อกุญแจที่เซ็นถูกถอน หรือคุณไม่เหลือ Use ที่ Agent นี้</Note>
    </Screen>
  );
}
