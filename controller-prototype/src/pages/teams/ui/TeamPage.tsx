import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { deleteTeam, hasRight, updateTeam, useProjects, useTeam, type Team } from "../../../entities/project";
import { turnOpen, useTasks } from "../../../entities/task";
import { canRead } from "../../../features/access";
import { newTeamTask } from "../../../features/demo-runtime";
import { canManageTeam, whyCycle, whyNotEmployee } from "../../../features/project-rules";
import { Button, confirm, Empty, Field, inform, Note, Row, Screen, Section, Select, space } from "../../../shared/ui";

// Each change needs Manage on the Agent it touches; the cap and deleting need it on the Entry (ADR 0064).
export function TeamPage() {
  const { team: id } = useLocalSearchParams<{ team: string }>();
  const team = useTeam(id);
  const agents = useAgents();
  const projects = useProjects();
  const tasks = useTasks();
  const me = useCurrentMember();

  if (!team) {
    return (
      <Screen title="Team">
        <Empty icon="members" title="ไม่พบ Team นี้" />
      </Screen>
    );
  }

  const current: Team = team;
  const manage = canManageTeam(me, current);
  const set = (patch: Partial<Team>) => updateTeam(current.id, patch);
  const name = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const inProjects = projects.filter((project) => project.doers.some((doer) => doer.kind === "team" && doer.id === current.id));
  const outside = agents.filter((agent) => agent.machineId === current.machineId && !current.employees.includes(agent.id));

  function changeEntry(entry: string) {
    const why = whyNotEmployee(me, entry, current.machineId) ?? whyCycle({ ...current, entry });
    if (why) return inform("ตั้งเป็น Entry ไม่ได้", why);
    set({ entry });
  }

  // Joining is consent to take work in every Project the Team is in, so the list is shown before signing.
  async function add(agentId: string) {
    const why = whyNotEmployee(me, agentId, current.machineId) ?? whyCycle({ ...current, employees: [...current.employees, agentId] });
    if (why) return inform(`เพิ่ม ${name(agentId)} ไม่ได้`, why);
    const where = inProjects.length ? `จะรับงานจากคนที่มีสิทธิ์ใน ${inProjects.map((project) => project.name).join(", ")}` : "Team นี้ยังไม่ได้อยู่ใน Project ไหน";
    if (!(await confirm({ title: `เพิ่ม ${name(agentId)} เข้า ${current.name}?`, message: `${name(agentId)} ${where} และพนักงานร่วมทีมอ่าน Workdir ของมันได้ระหว่างทำ Task ของทีม`, action: "เพิ่ม" }))) return;
    set({ employees: [...current.employees, agentId], roles: { ...current.roles, [agentId]: agents.find((agent) => agent.id === agentId)?.description ?? "" } });
  }

  function remove(agentId: string) {
    if (!can(me, agentId, "manage")) return inform("เอาออกไม่ได้", `ต้องมี Manage ที่ ${name(agentId)}`);
    if (tasks.some((task) => task.team === current.id && task.agent === agentId && turnOpen(task.events))) return inform("เอาออกไม่ได้", `${name(agentId)} ยังมี Turn ทำงานอยู่ หยุดก่อน`);
    set({ employees: current.employees.filter((candidate) => candidate !== agentId) });
  }

  async function removeTeam() {
    // ponytail: refused rather than cascading into Projects whose lists this person may not manage.
    if (inProjects.length) return inform("ลบไม่ได้", `เอา Team ออกจาก ${inProjects.map((project) => project.name).join(", ")} ก่อน`);
    if (await confirm({ title: `ลบ ${current.name}?`, message: "Agent ทุกตัวยังอยู่ ลบแค่การรวมทีม", action: "ลบ", destructive: true })) {
      router.replace("/teams");
      deleteTeam(current.id);
    }
  }

  return (
    <Screen title={current.name}>
      {!manage && <Note icon="lock">เพดานและการลบ Team ต้องมี Manage ที่ {name(current.entry)} ซึ่งเป็น Entry</Note>}

      <Section title="Task">
        <Row icon="add" title="Task ใหม่" detail="แชตกับทีม เลือก Project ที่ทำงานตอนเริ่ม" onPress={() => router.push(`/tasks/${newTeamTask(current, projects.find((project) => hasRight(project, me, "ask") && inProjects.includes(project))).id}`)} />
        {tasks.filter((task) => task.team === current.id && canRead(me, task)).map((task) => <Row key={task.id} icon="thread" title={task.title} href={`/tasks/${task.id}`} />)}
      </Section>

      <Section title="ทำงานใน Project ไหนได้บ้าง" footer="Team หนึ่งทำงานได้หลาย Project การแก้ Team มีผลกับทุก Project ในรายการนี้">
        {inProjects.length ? inProjects.map((project) => <Row key={project.id} icon="project" title={project.name} href={`/projects/${project.id}`} />) : <Row title="ยังไม่ได้อยู่ใน Project ไหน" detail="Team ทำงานได้เฉพาะใน Project คนที่มี Manage ของ Project เป็นคนเพิ่ม" />}
      </Section>

      <Section title="Entry และพนักงาน" footer="ตั้ง Entry หรือเอา Agent เข้าและออก ต้องมี Manage ที่ Agent ตัวนั้น ส่งงานเป็นวงข้าม Team บนเครื่องเดียวกันไม่ได้ Task ที่เปิดอยู่แล้วยังเป็นของ Entry ตัวเดิม">
        <Row title="Entry" accessory={<Select label="Entry" value={current.entry} options={current.employees.map((agentId) => ({ value: agentId, label: name(agentId) }))} onChange={changeEntry} />} />
        {current.employees.map((agentId) => (
          <View key={agentId}>
            {can(me, agentId, "manage") ? (
              <Field label={`${name(agentId)} ใช้เมื่อ`} value={current.roles[agentId] ?? ""} onChangeText={(text) => set({ roles: { ...current.roles, [agentId]: text } })} placeholder="เช่น ใช้ตัวนี้เมื่อต้องรีวิวโค้ด" />
            ) : (
              <Row title={name(agentId)} detail={current.roles[agentId]} />
            )}
            {agentId !== current.entry && (
              <View style={{ flexDirection: "row", paddingHorizontal: space.sm, paddingBottom: space.sm }}>
                <Button label={`เอา ${name(agentId)} ออก`} onPress={() => remove(agentId)} />
              </View>
            )}
          </View>
        ))}
        {outside.map((agent) => {
          const why = whyNotEmployee(me, agent.id, current.machineId);
          return why ? <Row key={agent.id} icon="lock" title={`เพิ่ม ${agent.name}`} detail={why} /> : <Row key={agent.id} icon="add" title={`เพิ่ม ${agent.name}`} detail={agent.description} onPress={() => add(agent.id)} />;
        })}
      </Section>

      <Section title="เพดานการส่งงาน" footer="Entry ส่งงานได้กี่ครั้งใน Turn หนึ่ง ถึงเพดานแล้วการส่งครั้งถัดไปได้ error กลับไปที่ Entry แต่ Turn ไม่จบ ตัวกันเรื่องเงินจริงคือ Budget ของพนักงานแต่ละตัว">
        <Row
          title="ครั้งต่อ Turn"
          value={String(current.cap)}
          accessory={
            <View style={{ flexDirection: "row", gap: space.xs }}>
              <Button label="−" disabled={!manage || current.cap <= 1} onPress={() => set({ cap: current.cap - 1 })} />
              <Button label="+" disabled={!manage || current.cap >= 20} onPress={() => set({ cap: current.cap + 1 })} />
            </View>
          }
        />
      </Section>

      {manage && (
        <Section>
          <Row icon="trash" destructive title="ลบ Team" onPress={removeTeam} />
        </Section>
      )}
    </Screen>
  );
}
