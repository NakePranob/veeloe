import { router } from "expo-router";
import { useState } from "react";
import { useAgents, useMachines } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { createTeam } from "../../../entities/project";
import { canCreateTeam, whyCycle, whyNotEmployee } from "../../../features/project-rules";
import { Empty, Field, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";

export function NewTeamPage() {
  const me = useCurrentMember();
  const machines = useMachines();
  const agents = useAgents();
  const mine = machines.filter((machine) => agents.some((agent) => agent.machineId === machine.id && can(me, agent.id, "manage")));
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState(mine[0]?.id ?? "");
  const [entry, setEntry] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  if (!canCreateTeam(me)) {
    return (
      <Screen title="Team ใหม่">
        <Empty icon="lock" title="สร้าง Team ไม่ได้" detail="ต้องมี Manage ที่ Agent อย่างน้อยหนึ่งตัว" />
      </Screen>
    );
  }

  const onMachine = agents.filter((agent) => agent.machineId === machineId);
  const entries = onMachine.filter((agent) => !whyNotEmployee(me, agent.id, machineId));
  const entryId = entries.some((agent) => agent.id === entry) ? entry : (entries[0]?.id ?? "");
  const employees = [entryId, ...picked.filter((id) => id !== entryId)].filter(Boolean);
  const candidate = { id: "new", name: name.trim() || "Team ใหม่", machineId, entry: entryId, employees };
  const problem = !name.trim() ? "ตั้งชื่อ Team" : !entryId ? "ไม่มี Agent บน Machine นี้ที่คุณมี Manage และไม่มี Channel จึงตั้ง Entry ไม่ได้" : whyCycle(candidate);

  function create() {
    const bad = problem ?? employees.map((id) => whyNotEmployee(me, id, machineId)).find(Boolean);
    if (bad) return inform("สร้างไม่ได้", bad);
    const roles = Object.fromEntries(employees.map((id) => [id, agents.find((agent) => agent.id === id)?.description ?? ""]));
    router.replace(`/teams/${createTeam({ name: name.trim(), machineId, employees, entry: entryId, roles }).id}`);
  }

  return (
    <Screen title="Team ใหม่" right={{ label: "สร้าง", onPress: create, disabled: !!problem }}>
      <Section>
        <Field label="ชื่อ" value={name} onChangeText={setName} placeholder="เช่น ทีม Release" />
        <Row
          title="Machine"
          detail="พนักงานทุกตัวต้องอยู่เครื่องเดียวกัน"
          accessory={
            <Select
              label="Machine"
              value={machineId}
              options={mine.map((machine) => ({ value: machine.id, label: machine.name }))}
              onChange={(next) => {
                setMachineId(next);
                setEntry("");
                setPicked([]);
              }}
            />
          }
        />
        <Row title="Entry" detail="รับข้อความของ Member และส่งงานให้พนักงานคนอื่น ต้องมี Manage ที่ตัวนั้น" accessory={entries.length ? <Select label="Entry" value={entryId} options={entries.map((agent) => ({ value: agent.id, label: agent.name }))} onChange={setEntry} /> : undefined} />
      </Section>
      <Section title="พนักงาน" footer="เพิ่มเข้า Team ต้องมี Manage ที่ Agent ตัวนั้น พนักงานร่วมทีมอ่าน Workdir ของกันได้ระหว่างทำ Task ของทีม">
        {onMachine
          .filter((agent) => agent.id !== entryId)
          .map((agent) => {
            const on = picked.includes(agent.id);
            const why = whyNotEmployee(me, agent.id, machineId) ?? whyCycle({ ...candidate, employees: [...employees, agent.id] });
            return why && !on ? (
              <Row key={agent.id} icon="lock" title={agent.name} detail={why} />
            ) : (
              <ToggleRow key={agent.id} title={agent.name} detail={agent.description} value={on} onChange={(value) => setPicked(value ? [...picked, agent.id] : picked.filter((id) => id !== agent.id))} />
            );
          })}
      </Section>
      {problem && <Note icon="info" iconColor="orange">{problem}</Note>}
    </Screen>
  );
}
