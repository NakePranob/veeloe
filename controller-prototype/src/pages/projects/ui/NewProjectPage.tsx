import { router } from "expo-router";
import { useState } from "react";
import { useAgents, useMachines } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { createProject, doerKey, RIGHT_LABEL, TEMPLATES, useTeams, type Doer, type Template } from "../../../entities/project";
import { canCreateProject, whyNotDoer } from "../../../features/project-rules";
import { Empty, Field, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";

const TEMPLATE_OPTIONS = (Object.keys(TEMPLATES) as Template[]).map((value) => ({ value, label: TEMPLATES[value].label }));

// Whoever holds Manage of one Agent may start a Project. It opens to its creator alone, and may
// start with nobody to work in it (ADR 0046, 0064).
export function NewProjectPage() {
  const me = useCurrentMember();
  const machines = useMachines();
  const agents = useAgents();
  const teams = useTeams();
  const mine = machines.filter((machine) => agents.some((agent) => agent.machineId === machine.id && can(me, agent.id, "manage")));
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<Template>("code");
  const [machineId, setMachineId] = useState(mine[0]?.id ?? "");
  const [picked, setPicked] = useState<Doer[]>([]);

  if (!canCreateProject(me)) {
    return (
      <Screen title="Project ใหม่">
        <Empty icon="lock" title="สร้าง Project ไม่ได้" detail="ต้องมี Manage ที่ Agent อย่างน้อยหนึ่งตัว" />
      </Screen>
    );
  }

  const candidates: { doer: Doer; title: string; detail: string }[] = [
    ...teams.filter((team) => team.machineId === machineId).map((team) => ({ doer: { kind: "team" as const, id: team.id }, title: team.name, detail: `Team · ${team.employees.length} พนักงาน` })),
    ...agents.filter((agent) => agent.machineId === machineId).map((agent) => ({ doer: { kind: "agent" as const, id: agent.id }, title: agent.name, detail: agent.description })),
  ];
  const problem = !name.trim() ? "ตั้งชื่อ Project" : null;
  const preset = TEMPLATES[template];

  function create() {
    // The same check again at the moment of sending, since a Team may have changed.
    const bad = problem ?? picked.map((doer) => whyNotDoer(me, doer, machineId)).find(Boolean);
    if (bad) return inform("สร้างไม่ได้", bad);
    const project = createProject({ name: name.trim(), template, machineId, doers: picked, repos: preset.repos, worktreeDefault: preset.worktree, skills: preset.skills }, me.id);
    router.replace(`/projects/${project.id}`);
  }

  return (
    <Screen title="Project ใหม่" right={{ label: "สร้าง", onPress: create, disabled: !!problem }}>
      <Section footer={`${preset.detail} แม่แบบเป็นแค่ค่าตั้งต้น แก้ได้ทีหลังที่ตั้งค่า`}>
        <Field label="ชื่อ" value={name} onChangeText={setName} placeholder="เช่น Checkout 2.5" />
        <Row title="แม่แบบ" accessory={<Select label="แม่แบบ" value={template} options={TEMPLATE_OPTIONS} onChange={setTemplate} />} />
        <Row
          title="Machine"
          detail="ไฟล์ของ Project อยู่บนเครื่องนี้ ผู้ทำงานจึงต้องอยู่เครื่องเดียวกัน"
          accessory={
            <Select
              label="Machine"
              value={machineId}
              options={mine.map((machine) => ({ value: machine.id, label: machine.name }))}
              onChange={(next) => {
                setMachineId(next);
                setPicked([]);
              }}
            />
          }
        />
      </Section>
      <Section title="ผู้ทำงาน" footer="เอาเข้าต้องมี Manage ที่ Agent ตัวนั้น หรือที่ Agent ทุกตัวใน Team เพราะเท่ากับยินยอมให้รับงานจากคนใน Project เพิ่มทีหลังที่ตั้งค่าก็ได้">
        {candidates.map(({ doer, title, detail }) => {
          const why = whyNotDoer(me, doer, machineId);
          const on = picked.some((candidate) => doerKey(candidate) === doerKey(doer));
          return why ? (
            <Row key={doerKey(doer)} icon="lock" title={title} detail={why} />
          ) : (
            <ToggleRow key={doerKey(doer)} title={title} detail={detail} value={on} onChange={(value) => setPicked(value ? [...picked, doer] : picked.filter((candidate) => doerKey(candidate) !== doerKey(doer)))} />
          );
        })}
      </Section>
      {problem && <Note icon="info" iconColor="orange">{problem}</Note>}
      <Note icon="key">เข้าได้เฉพาะคุณจนกว่าจะให้สิทธิ์คนอื่น คุณจะได้ {RIGHT_LABEL.manage} ของ Project นี้ แล้วแจก View, Ask หรือ Use ได้ที่หน้าตั้งค่า</Note>
    </Screen>
  );
}
