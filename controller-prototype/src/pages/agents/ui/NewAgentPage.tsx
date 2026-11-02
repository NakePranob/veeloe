import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Character, createAgent, READ_ONLY_COMMANDS, shuffleLook, useAgents, useMachines } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { newTask } from "../../../features/demo-runtime";
import { authenticate, Button, Empty, Field, inform, Note, Row, Screen, Section, Select, space, ToggleRow } from "../../../shared/ui";

// Only an Owner creates an Agent: it is nearly the same as reaching the Machine's files (ADR 0031).
export function NewAgentPage() {
  const me = useCurrentMember();
  const machines = useMachines();
  const agents = useAgents();
  const first = machines.find((machine) => machine.online && machine.providers.length) ?? machines[0];
  const [form, setForm] = useState({ name: "", description: "", instructions: "", machineId: first?.id ?? "", providerId: first?.providers[0]?.id ?? "", model: first?.providers[0]?.models[0] ?? "" });
  // The read-only set is ticked and can be taken off before signing (ADR 0030).
  const [commands, setCommands] = useState<string[]>(READ_ONLY_COMMANDS);
  const [look, setLook] = useState(() => shuffleLook(agents.map((agent) => agent.character)));

  if (!me.owner) {
    return (
      <Screen title="Agent ใหม่">
        <Empty icon="lock" title="เฉพาะ Owner สร้าง Agent ได้" detail="การสร้าง Agent เกือบเท่ากับเข้าถึงไฟล์บนเครื่องนั้น ให้ Owner สร้างแล้วแจก Manage ให้คนที่จะดูแล" />
      </Screen>
    );
  }

  const machine = machines.find((candidate) => candidate.id === form.machineId);
  const provider = machine?.providers.find((candidate) => candidate.id === form.providerId);
  const ready = !!form.name.trim() && !!machine && !!provider;

  function chooseMachine(machineId: string) {
    const next = machines.find((candidate) => candidate.id === machineId);
    setForm({ ...form, machineId, providerId: next?.providers[0]?.id ?? "", model: next?.providers[0]?.models[0] ?? "" });
  }

  function chooseProvider(providerId: string) {
    setForm({ ...form, providerId, model: machine?.providers.find((candidate) => candidate.id === providerId)?.models[0] ?? "" });
  }

  async function create() {
    const name = form.name.trim();
    if (!machine || !provider) return;
    if (agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase())) return inform("สร้างไม่ได้", `มี Agent ชื่อ ${name} แล้ว`);
    if (!machine.online) return inform("Machine ออฟไลน์", `Runtime บน ${machine.name} สร้าง Workdir ของ Agent ให้ จึงต้องออนไลน์ก่อน`);
    const description = form.description.trim();
    if (!(await authenticate(`สร้าง Agent ${name} บน ${machine.name} Allowlist เริ่มต้น ${commands.length} รายการ`))) return;
    const agent = createAgent({ name, description, instructions: form.instructions.trim() || `คุณคือ ${name} ${description}`.trim(), machineId: machine.id, character: look, providerId: provider.id, model: form.model, allowlist: commands });
    router.replace(`/tasks/${newTask(agent.id).id}`);
  }

  return (
    <Screen title="Agent ใหม่" right={{ label: "สร้าง", onPress: create, disabled: !ready }}>
      <View style={{ alignItems: "center", gap: space.sm }}>
        <Character look={look} mood="idle" size={96} />
        <Button label="สุ่ม Character ใหม่" onPress={() => setLook(shuffleLook(agents.map((agent) => agent.character)))} />
      </View>
      <Section footer="Character แก้ทีหลังได้ที่หน้าของ Agent">
        <Field label="ชื่อ" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="เช่น Deployer" />
        <Field label="คำอธิบาย" value={form.description} onChangeText={(description) => setForm({ ...form, description })} placeholder="ทำอะไร" />
        <Field label="คำสั่งของ Agent" value={form.instructions} onChangeText={(instructions) => setForm({ ...form, instructions })} multiline footer="เว้นว่างไว้ แอปจะใช้ ชื่อและคำอธิบายข้างบน คำสั่งนี้ Agent แก้เองไม่ได้ (ADR 0038)" />
      </Section>

      <Section title="อยู่บน Machine" footer="Agent อยู่ Machine เดียวตลอดและแตะได้แค่ไฟล์กับ tool ของเครื่องนั้น Runtime สร้าง Workdir ให้ที่ ~/.veeloe/agents/<id>/workdir เลือก path เองไม่ได้ (ADR 0002, 0032)">
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Select label="Machine" value={form.machineId} options={machines.map((candidate) => ({ value: candidate.id, label: candidate.online ? candidate.name : `${candidate.name} (ออฟไลน์)` }))} onChange={chooseMachine} />
        </View>
      </Section>

      <Section title="Provider และ model" footer="รายชื่อ model มาจาก Provider ที่ตั้งบน Machine นี้ คนที่มี Manage เปลี่ยนทีหลังได้ และมีผลตั้งแต่ Task ถัดไป (ADR 0042)">
        {machine && machine.providers.length === 0 ? (
          <Row icon="key" title="Machine นี้ยังไม่มี Provider" detail="เพิ่ม Provider ที่หน้าของ Machine ก่อน" href={`/machines/${machine.id}`} />
        ) : (
          <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm, flexWrap: "wrap" }}>
            <Select label="Provider" value={form.providerId} options={(machine?.providers ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={chooseProvider} />
            <Select label="model" value={form.model} options={(provider?.models ?? []).map((model) => ({ value: model, label: model }))} onChange={(model) => setForm({ ...form, model })} />
          </View>
        )}
      </Section>

      <Section title="คำสั่งที่รันได้เลยไม่ต้องขอ Approval" footer="ชุดอ่านอย่างเดียวติ๊กไว้ให้ เอาออกได้ก่อนเซ็น ไม่มี find เพราะมี -exec กับ -delete ไม่มี sed เพราะมี -i และไม่มี git หรือ npm ทั้งตัว (ADR 0030)">
        {READ_ONLY_COMMANDS.map((command) => (
          <ToggleRow key={command} title={command} value={commands.includes(command)} onChange={(on) => setCommands(on ? READ_ONLY_COMMANDS.filter((item) => item === command || commands.includes(item)) : commands.filter((item) => item !== command))} />
        ))}
      </Section>
      <Note>Budget เริ่มต้นที่ 10M token ต่อวัน ตั้งทีหลังได้ที่หน้าของ Agent (ADR 0043)</Note>
    </Screen>
  );
}
