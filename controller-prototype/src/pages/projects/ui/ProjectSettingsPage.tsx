import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { can, GRANT_LABEL, useCurrentMember, useMembers } from "../../../entities/member";
import { deleteProject, doerAgents, doerKey, doerOwner, hasRight, projectAgents, RIGHT_DETAIL, RIGHT_LABEL, setRight, TEMPLATES, updateProject, useProject, useTeams, type Doer, type Project, type ProjectRight, type Template } from "../../../entities/project";
import { deleteTasks, turnOpen, updateTask, useTasks } from "../../../entities/task";
import { descendants, stopTurn } from "../../../features/demo-runtime";
import { whyNotDoer } from "../../../features/project-rules";
import { authenticate, Button, confirm, Empty, Field, inform, Note, Row, Screen, Section, Select, space, ToggleRow } from "../../../shared/ui";

const RIGHT_OPTIONS: { value: ProjectRight | "none"; label: string }[] = [
  { value: "none", label: "ไม่มีสิทธิ์" },
  { value: "view", label: "View" },
  { value: "ask", label: "Ask" },
  { value: "use", label: "Use" },
  { value: "manage", label: "Manage" },
];
const TEMPLATE_OPTIONS = (Object.keys(TEMPLATES) as Template[]).map((value) => ({ value, label: TEMPLATES[value].label }));

// A line to add to a list: a path, a topic or a repo.
function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <View>
      <Field label={label} value={text} onChangeText={setText} placeholder={placeholder} />
      <View style={{ flexDirection: "row", paddingHorizontal: space.sm, paddingBottom: space.sm }}>
        <Button
          label="เพิ่ม"
          disabled={!text.trim()}
          onPress={() => {
            onAdd(text.trim());
            setText("");
          }}
        />
      </View>
    </View>
  );
}

// Everything here is Manage of the Project: rights, who may work here, what Ask may not read or answer (ADR 0046, 0064).
export function ProjectSettingsPage() {
  const { project: id } = useLocalSearchParams<{ project: string }>();
  const project = useProject(id);
  const agents = useAgents();
  const teams = useTeams();
  const members = useMembers().filter((member) => !member.removed);
  const tasks = useTasks();
  const me = useCurrentMember();

  if (!project || !hasRight(project, me, "manage")) {
    return (
      <Screen title="ตั้งค่า Project">
        <Empty icon="lock" title="ต้องมี Manage ของ Project" detail="ตั้งสิทธิ์ จัดรายชื่อผู้ทำงาน และตั้งค่าของ Project ได้เฉพาะคนที่มี Manage" />
      </Screen>
    );
  }

  const set = (patch: Partial<Project>) => updateProject(project.id, patch);
  const name = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const rooms = tasks.filter((task) => task.project === project.id && !task.parent);

  async function changeRight(memberId: string, memberLabel: string, value: ProjectRight | "none") {
    const keepsManage = members.some((member) => member.id !== memberId && hasRight(project, member, "manage"));
    if (value !== "manage" && memberId === me.id && !me.owner && !keepsManage) return inform("เปลี่ยนไม่ได้", "Project ต้องมีคนที่มี Manage อย่างน้อยหนึ่งคน");
    // Handing out rights is a Grant, so it asks for the Member's face or fingerprint (ADR 0012).
    if (!(await authenticate(`ให้ ${memberLabel} สิทธิ์ ${value === "none" ? "ไม่มี" : RIGHT_LABEL[value]} ใน Project ${project?.name}`))) return;
    setRight(project?.id ?? "", memberId, value === "none" ? null : value);
  }

  const doerName = (doer: Doer) => (doer.kind === "team" ? (teams.find((team) => team.id === doer.id)?.name ?? "Team") : name(doer.id));

  function addDoer(doer: Doer) {
    const why = whyNotDoer(me, doer, project?.machineId ?? "");
    if (why) return inform(`เพิ่ม ${doerName(doer)} ไม่ได้`, why);
    const doers = [...(project?.doers ?? []), doer];
    set({ doers, wikiWriter: project?.wikiWriter || doerOwner(doer) });
  }

  // Taking one off stops its work here after a warning; its Tasks stay to read (ADR 0064).
  async function removeDoer(doer: Doer) {
    const missing = doerAgents(doer).find((agentId) => !can(me, agentId, "manage"));
    if (missing) return inform("เอาออกไม่ได้", `ต้องมี Manage ที่ ${name(missing)}`);
    const own = rooms.filter((room) => (doer.kind === "team" ? room.team === doer.id : !room.team && room.agent === doer.id));
    const running = own.filter((room) => [room, ...descendants(room.id, tasks)].some((task) => turnOpen(task.events)));
    if (own.length && !(await confirm({ title: `เอา ${doerName(doer)} ออก?`, message: `${running.length ? `Turn ที่ทำอยู่ ${running.length} งานจะหยุด ` : ""}งาน ${own.length} งานยังเปิดอ่านได้ แต่สั่งต่อไม่ได้`, action: "เอาออก", destructive: true }))) return;
    running.forEach((room) => stopTurn(room.id));
    own.forEach((room) => updateTask(room.id, { readOnly: true }));
    const doers = (project?.doers ?? []).filter((candidate) => doerKey(candidate) !== doerKey(doer));
    const left = doers.flatMap((candidate) => doerAgents(candidate));
    set({ doers, wikiWriter: left.includes(project?.wikiWriter ?? "") ? project?.wikiWriter : (left[0] ?? "") });
  }

  async function remove() {
    const all = rooms.flatMap((room) => [room.id, ...descendants(room.id, tasks).map((task) => task.id)]);
    const running = all.some((taskId) => turnOpen(tasks.find((task) => task.id === taskId)?.events ?? []));
    if (running) return inform("ลบไม่ได้", "ยังมี Turn ทำงานอยู่ใน Project หยุดก่อน");
    if (!(await confirm({ title: `ลบ Project ${project?.name}?`, message: `ห้องกับ Task ย่อยทั้งหมด ${all.length} Task จะหายจากแอป ไฟล์ใน Workdir ของผู้ทำงานไม่ถูกแตะ`, action: "ลบ", destructive: true }))) return;
    router.replace("/projects");
    deleteProject(project?.id ?? "");
    deleteTasks(all);
  }

  const listed = project.doers.map(doerKey);
  const outside: Doer[] = [
    ...teams.filter((team) => team.machineId === project.machineId).map((team) => ({ kind: "team" as const, id: team.id })),
    ...agents.filter((agent) => agent.machineId === project.machineId).map((agent) => ({ kind: "agent" as const, id: agent.id })),
  ].filter((doer) => !listed.includes(doerKey(doer)));
  const staff = projectAgents(project, teams);

  return (
    <Screen title="ตั้งค่า Project">
      <Section title="สิทธิ์ใน Project" footer="ใน Project ใช้สิทธิ์ของ Project นอก Project ใช้สิทธิ์ของ Agent Approval ไปที่คนที่มี Approve ที่ Agent ตัวนั้นเสมอ Project ไม่มีระดับ Approve">
        {members.map((member) =>
          member.owner ? (
            <Row key={member.id} icon="member" title={member.name} detail="Owner · Manage ทุก Project" value="Manage" />
          ) : (
            <Row
              key={member.id}
              icon="member"
              title={member.name}
              detail={`กับ Agent ตรงๆ: ${projectAgents(project, teams).map((agentId) => `${name(agentId)} ${member.grants[agentId] ? GRANT_LABEL[member.grants[agentId]] : "-"}`).join(" · ")}`}
              accessory={<Select label={`สิทธิ์ของ ${member.name}`} value={project.rights[member.id] ?? "none"} options={RIGHT_OPTIONS} onChange={(value) => changeRight(member.id, member.name, value)} />}
            />
          ),
        )}
        <Row title="ระดับ" detail={(["view", "ask", "use", "manage"] as const).map((level) => `${RIGHT_LABEL[level]}: ${RIGHT_DETAIL[level]}`).join("\n")} />
      </Section>

      <Section title="ผู้ทำงาน" footer="เอาเข้าหรือออกต้องมี Manage ที่ Agent ตัวนั้น หรือที่ Agent ทุกตัวใน Team เพราะเท่ากับยินยอมให้รับงานจากคนที่มีสิทธิ์ใน Project Entry และเพดานการส่งงานตั้งที่หน้า Team">
        {project.doers.map((doer) => (
          <Row key={doerKey(doer)} icon={doer.kind === "team" ? "members" : "agent"} title={doerName(doer)} detail={doer.kind === "team" ? "Team" : "Agent ตัวเดียว"} accessory={<Button label="เอาออก" onPress={() => removeDoer(doer)} />} />
        ))}
        {outside.map((doer) => {
          const why = whyNotDoer(me, doer, project.machineId);
          return why ? <Row key={doerKey(doer)} icon="lock" title={`เพิ่ม ${doerName(doer)}`} detail={why} /> : <Row key={doerKey(doer)} icon="add" title={`เพิ่ม ${doerName(doer)}`} detail={doer.kind === "team" ? "Team" : "Agent ตัวเดียว"} onPress={() => addDoer(doer)} />;
        })}
        {staff.length > 0 && <Row title="ผู้เขียน wiki" detail="มีตัวเดียว ตัวอื่นอ่านได้อย่างเดียว" accessory={<Select label="ผู้เขียน wiki" value={project.wikiWriter} options={staff.map((agentId) => ({ value: agentId, label: name(agentId) }))} onChange={(wikiWriter) => set({ wikiWriter })} />} />}
      </Section>

      <Section title="path ที่ Ask อ่านไม่ได้" footer="ข้อนี้กันได้จริง เพราะ sandbox ของ Turn แบบ Ask ไม่เปิด path เหล่านี้ ไฟล์ลับอย่าง .env และ *.pem ห้ามเสมอโดยไม่ต้องใส่">
        {project.forbiddenPaths.map((path) => (
          <Row key={path} icon="lock" iconColor="red" mono title={path} onPress={() => set({ forbiddenPaths: project.forbiddenPaths.filter((entry) => entry !== path) })} detail="กดเพื่อเอาออก" />
        ))}
        <AddLine label="เพิ่ม path" placeholder="เช่น secrets/" onAdd={(path) => !project.forbiddenPaths.includes(path) && set({ forbiddenPaths: [...project.forbiddenPaths, path] })} />
      </Section>

      <Section title="Task ที่ปิดจาก Ask" footer="Task ที่ปิด tool ค้นหาไม่เจอ และคนที่มีแค่ View หรือ Ask ไม่เห็นห้องนั้น กันได้จริงเหมือน path">
        {rooms.length ? rooms.map((room) => <ToggleRow key={room.id} title={room.title} value={project.closedToAsk.includes(room.id)} onChange={(on) => set({ closedToAsk: on ? [...project.closedToAsk, room.id] : project.closedToAsk.filter((entry) => entry !== room.id) })} />) : <Row title="ยังไม่มีห้อง" />}
      </Section>

      <Section title="หัวข้อที่ขอให้ไม่ตอบ">
        {project.forbiddenTopics.map((topic) => (
          <Row key={topic} icon="ask" iconColor="red" title={topic} onPress={() => set({ forbiddenTopics: project.forbiddenTopics.filter((entry) => entry !== topic) })} detail="กดเพื่อเอาออก" />
        ))}
        <AddLine label="เพิ่มหัวข้อ" placeholder="เช่น เงินเดือน" onAdd={(topic) => !project.forbiddenTopics.includes(topic) && set({ forbiddenTopics: [...project.forbiddenTopics, topic] })} />
      </Section>
      <Note icon="info" iconColor="orange">
        ข้อนี้เป็นแค่ “ขอให้ไม่ตอบ” คือคำสั่งที่ส่งให้ LLM ไม่ใช่ “ตอบไม่ได้” คนถามเลี่ยงได้ด้วยการถามอ้อม ความลับจริงต้องอยู่ใน path ที่ห้ามอ่านหรือใน Task ที่ปิดจาก Ask
      </Note>

      <Section title="repo และแม่แบบ" footer="แม่แบบเป็นแค่ค่าตั้งต้น ไม่ได้เป็นระบบแยก repo ที่เพิ่มหรือเอาออกมีผลกับ Worktree ของ Task ที่เปิดใหม่">
        <Row title="แม่แบบ" accessory={<Select label="แม่แบบ" value={project.template} options={TEMPLATE_OPTIONS} onChange={(template) => set({ template })} />} />
        <Row
          icon="restart"
          title="ใช้ค่าตั้งต้นของแม่แบบนี้"
          detail={`repo: ${TEMPLATES[project.template].repos.join(", ") || "ไม่มี"} · Worktree ${TEMPLATES[project.template].worktree ? "ติ๊กไว้ก่อน" : "ปิดไว้ก่อน"}`}
          onPress={async () => {
            const preset = TEMPLATES[project.template];
            if (await confirm({ title: "ใช้ค่าตั้งต้นของแม่แบบ?", message: "repo, Worktree และ Skill ที่แนะนำจะถูกแทนที่", action: "แทนที่" })) set({ repos: preset.repos, worktreeDefault: preset.worktree, skills: preset.skills });
          }}
        />
        <ToggleRow icon="branch" title="ติ๊ก Worktree ไว้ก่อนตอนเริ่ม Task" value={project.worktreeDefault} onChange={(worktreeDefault) => set({ worktreeDefault })} />
        {project.repos.map((repo) => (
          <Row key={repo} icon="branch" iconColor="red" mono title={repo} detail="กดเพื่อเอาออก" onPress={() => set({ repos: project.repos.filter((entry) => entry !== repo) })} />
        ))}
        <AddLine label="เพิ่ม repo" placeholder="เช่น api" onAdd={(repo) => !project.repos.includes(repo) && set({ repos: [...project.repos, repo] })} />
        <Field label="Skill ที่แนะนำ" value={project.skills.join(", ")} onChangeText={(text) => set({ skills: text.split(",").map((skill) => skill.trim()).filter(Boolean) })} footer="เป็นแค่รายการแนะนำ ติดตั้งจริงที่หน้า Skill ของแต่ละ Agent" />
      </Section>

      <Section>
        <Row icon="trash" destructive title="ลบ Project" detail="ห้องและ Task ย่อยทั้งหมดหายไปจากแอป" onPress={remove} />
      </Section>
    </Screen>
  );
}
