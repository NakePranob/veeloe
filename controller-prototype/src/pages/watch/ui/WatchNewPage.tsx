import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { addAutomation, newId } from "../../../entities/automation";
import { useLibraries } from "../../../entities/library";
import { can, thisDevice, useCurrentMember } from "../../../entities/member";
import { newSignature } from "../../../features/signing";
import { Empty, Field, inform, Note, Row, Screen, Section, Select } from "../../../shared/ui";
import { checkWatchPath, MAX_WAIT_MINUTES } from "../../../widgets/background-work";

// ponytail: what an Agent would propose after noticing a file it keeps being asked about.
const PROPOSAL: Record<string, { path: string; on: "changed" | "new"; action: string }> = {
  writer: { path: "workdir/drafts/", on: "new", action: "อ่านร่างใหม่แล้วเช็กคำผิดกับลิงก์เสีย" },
  tester: { path: "workdir/reports/latest.json", on: "changed", action: "สรุปว่า test ที่พังรอบนี้ต่างจากรอบก่อนตรงไหน" },
  reviewer: { path: "workdir/review-queue.md", on: "changed", action: "ไล่ดู PR ที่เพิ่มเข้ามาในคิวแล้วสรุปให้" },
  deployer: { path: "/var/log/deploy/last.log", on: "changed", action: "อ่านท้าย log แล้วบอกถ้ามี error" },
};

// A Watch is a standing instruction, so it needs a signature before it first watches (ADR 0057).
export function WatchNewPage() {
  const { agent: preset } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  const libraries = useLibraries();
  const [agentId, setAgentId] = useState(agents.find((agent) => agent.id === preset)?.id ?? agents[0]?.id ?? "");
  const [path, setPath] = useState("");
  const [on, setOn] = useState<"changed" | "new">("changed");
  const [action, setAction] = useState("");
  const [debounce, setDebounce] = useState("5");
  const [proposed, setProposed] = useState(false);
  const device = thisDevice(me);

  if (agents.length === 0) return <Screen title="Watch ใหม่"><Empty icon="watch" title="ต้องมี Use ที่ Agent อย่างน้อยหนึ่งตัว" /></Screen>;

  const level = can(me, agentId, "manage") ? "manage" : "use";
  const readable = libraries.filter((library) => library.access[agentId]).map((library) => library.id);
  const check = path.trim() ? checkWatchPath(path, level, readable) : undefined;
  const wait = /^\d+$/.test(debounce.trim()) ? Math.min(MAX_WAIT_MINUTES, Math.max(1, Number(debounce))) : 5;

  const propose = () => {
    const proposal = PROPOSAL[agentId] ?? PROPOSAL.writer;
    setPath(proposal.path);
    setOn(proposal.on);
    setAction(proposal.action);
    setProposed(true);
  };

  const save = () => {
    const verdict = checkWatchPath(path, level, readable);
    if (!verdict.ok) return inform("เฝ้าที่นี่ไม่ได้", verdict.reason);
    if (!action.trim()) return inform("ยังไม่ได้บอกว่าให้ทำอะไร");
    if (!device) return inform("เซ็นไม่ได้", "ไม่มีกุญแจของ Controller เครื่องนี้ที่ใช้ได้");
    const id = newId("watch");
    addAutomation("watches", { id, agent: agentId, path: path.trim(), on, action: action.trim(), debounceMinutes: wait, paused: false, proposedBy: proposed ? "agent" : "member", log: [], ...newSignature() });
    router.replace(`/automation/watches/${id}`);
  };

  return (
    <Screen title="Watch ใหม่" right={{ label: "เซ็นและเริ่มเฝ้า", onPress: save }}>
      <Section title="Agent" footer={level === "manage" ? "คุณมี Manage จึงเฝ้าไฟล์ใดก็ได้บนเครื่องที่ไม่ใช่ไฟล์ลับ" : "คุณมีแค่ Use จึงเฝ้าได้แค่ Workdir (workdir/...) กับ Library (library/<ชื่อ>/...) ที่ Agent นี้อ่านได้ ใช้ Watch สืบไฟล์อื่นบนเครื่องไม่ได้"}>
        <Row title="Agent" accessory={<Select label="Agent" value={agentId} options={agents.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={(value) => { setAgentId(value); setProposed(false); }} />} />
        <Row icon="agent" title="ให้ Agent เสนอ Watch" detail="Agent สังเกตว่ามีไฟล์ที่ควรเฝ้า แล้วเสนอ ยังไม่เฝ้าจนกว่าคุณจะเซ็น" onPress={propose} />
      </Section>

      <Section title={proposed ? "ร่างที่ Agent เสนอ" : "เฝ้าอะไร"} footer={proposed ? "อ่านให้ครบแล้วแก้ได้ก่อนเซ็น" : undefined}>
        <Field label="path" value={path} onChangeText={(text) => { setPath(text); setProposed(false); }} placeholder="workdir/drafts/" mono />
        {check && (check.ok ? <Row icon="done" iconColor="green" title={check.where === "workdir" ? "อยู่ใน Workdir" : check.where === "library" ? "อยู่ใน Library ที่ Agent อ่านได้" : "ที่อื่นบนเครื่อง (ต้องมี Manage)"} /> : <Row icon="failed" iconColor="red" title={check.reason} />)}
        <Row title="เงื่อนไข" accessory={<Select label="เงื่อนไข" value={on} options={[{ value: "changed", label: "ไฟล์เปลี่ยน" }, { value: "new", label: "มีไฟล์ใหม่" }]} onChange={setOn} />} />
        <Field label="ถึงแล้วให้ทำอะไร" value={action} onChangeText={setAction} multiline placeholder="เช่น อ่านร่างใหม่แล้วเช็กคำผิด" />
      </Section>

      <Section title="การรวม event" footer={`ไฟล์ที่เปลี่ยนถี่ๆ รวมเป็นงานเดียว รอให้เงียบ ${wait} นาที แต่รอนานสุด ${MAX_WAIT_MINUTES} นาที ไฟล์ log ที่เปลี่ยนตลอดจึงไม่ทำให้งานถูกเลื่อนไปเรื่อยๆ`}>
        <Field label="รอให้เงียบกี่นาที (1 ถึง 30)" value={debounce} onChangeText={setDebounce} keyboardType="numeric" />
      </Section>

      <Section title="สิ่งที่จะเซ็น">
        <Row icon="key" title={`เซ็นในนามของ ${me.name}`} detail="ถึงเงื่อนไขแล้วเปิด Task ใหม่ในนามคุณ ตรวจสิทธิ์ ขอ Approval และใช้ Budget เหมือนงานปกติ" />
      </Section>
      <Note icon="info">การเขียนไฟล์ของ Agent เองไม่นับเป็น event เนื้อไฟล์ที่เปลี่ยนถือเป็นข้อมูลดิบ ไม่ใช่คำสั่ง งานนี้ใช้ token ภายใต้เพดานร่วมกับ Idle Work</Note>
    </Screen>
  );
}
