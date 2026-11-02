import { router } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { searchLibrary, type Library } from "../../../entities/library";
import { can, type Member } from "../../../entities/member";
import { startProactiveTask } from "../../../features/demo-runtime";
import { Button, Field, inform, Note, Row, Section, Select } from "../../../shared/ui";

// Anyone with Use at an Agent that reads the Library may ask for its content through that Agent.
export function Ask({ library, me }: { library: Library; me: Member }) {
  const agents = useAgents().filter((agent) => library.access[agent.id] && can(me, agent.id, "use"));
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const agent = agents.find((candidate) => candidate.id === agentId) ?? agents[0];
  if (!agent) return <Note>คุณไม่มี Use ที่ Agent ที่อ่าน Library นี้ จึงถามเนื้อหาไม่ได้</Note>;

  const ask = () => {
    if (!agent.machine.online) return inform("ถามไม่ได้", `${agent.machine.name} ปิดอยู่ ถามได้เมื่อ Machine กลับมา`);
    const found = searchLibrary(library, question).slice(0, 3);
    // ponytail: a word match stands in for the Agent reading the pages with grep (ADR 0037).
    const reply = found.length
      ? `จาก Library ${library.name}:\n${found.map(({ page }) => `- **${page.path}**: ${page.content.replace(/^#.*\n+/, "").replace(/\n+/g, " ").slice(0, 140)}`).join("\n")}`
      : "ไม่พบในคลังนี้";
    const task = startProactiveTask({ agent: agent.id, title: `ถาม ${library.name}: ${question.slice(0, 24)}`, message: question, member: me.id, source: "app", reply, shared: false });
    router.push(`/tasks/${task.id}`);
  };

  return (
    <Section title="ถามผ่าน Agent" footer="Agent อ่าน Library แล้วตอบใน Task ของคุณ คุณเห็นเนื้อหาผ่าน Agent นี้ได้เพราะมี Use ที่ Agent ที่อ่านได้">
      <Field label="คำถาม" value={question} onChangeText={setQuestion} placeholder="เช่น deploy ต้องทำอะไรบ้าง" multiline />
      <Row title="ถามผ่าน" accessory={<Select label="Agent" value={agent.id} options={agents.map((item) => ({ value: item.id, label: item.name }))} onChange={setAgentId} />} />
      <Row title="ถาม" accessory={<Button label="ถาม" variant="primary" disabled={!question.trim()} onPress={ask} />} />
    </Section>
  );
}
