import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useAgents, useMachines } from "../../../entities/agent";
import { memberName, useCurrentMember } from "../../../entities/member";
import { doerKey, hasRight, RIGHT_DETAIL, RIGHT_LABEL, rightOf, TEMPLATES, useProject, useTeams, type Doer } from "../../../entities/project";
import { STATUS_LABEL, stateOf, useTasks, type Task } from "../../../entities/task";
import { canRead, waitingOn } from "../../../features/access";
import { startProjectTask } from "../../../features/demo-runtime";
import { useNow } from "../../../shared/lib";
import { Button, Card, Empty, inform, Row, Screen, Section, space, Text } from "../../../shared/ui";

// A Project is the place and has no chat of its own: its page shows the work and who may do it.
// Every chat is with an Agent or a Team (ADR 0064).
export function ProjectPage() {
  const { project: id } = useLocalSearchParams<{ project: string }>();
  const project = useProject(id);
  const agents = useAgents();
  const teams = useTeams();
  const machines = useMachines();
  const tasks = useTasks();
  const me = useCurrentMember();
  const now = useNow();
  const right = rightOf(project, me);

  // Not found and not allowed look the same, so a Member cannot probe for Projects.
  if (!project || !right) {
    return (
      <Screen title="Project">
        <Empty icon="lock" title="ไม่พบ Project นี้" detail="ถ้าคุณควรเห็น ให้ขอสิทธิ์ View จากคนที่มี Manage ของ Project" />
      </Screen>
    );
  }

  const agentName = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const doerName = (doer: Doer) => (doer.kind === "team" ? (teams.find((team) => team.id === doer.id)?.name ?? "Team") : agentName(doer.id));
  const taskDoer = (task: Task) => (task.team ? (teams.find((team) => team.id === task.team)?.name ?? "Team") : agentName(task.agent));

  const canAsk = hasRight(project, me, "ask");
  const hasRepos = project.repos.length > 0;
  const mine = tasks.filter((task) => task.project === project.id);
  const waiting = mine.filter((task) => waitingOn(me, task, now));
  const jobs = mine.filter((task) => !task.parent && canRead(me, task));

  return (
    <Screen title={project.name}>
      {waiting.length > 0 && (
        <Section title="ต้องการคุณ">
          {waiting.map((task) => (
            <Row key={task.id} icon="info" iconColor="orange" title={task.title} detail={`${agentName(task.agent)} ขออนุมัติ`} href={`/tasks/${task.id}`} />
          ))}
        </Section>
      )}

      <Section title="งาน" footer="แตะงานแล้วเปิดแชตกับ Agent หรือ Team ที่ทำงานนั้น">
        {jobs.length === 0 && <Row title="ยังไม่มีงานที่คุณเห็น" />}
        {jobs.map((job) => (
          <View key={job.id}>
            <Row
              icon="thread"
              title={job.title}
              detail={`${taskDoer(job)} · ${memberName(job.starter)}${project.closedToAsk.includes(job.id) ? " · ปิดจาก Ask" : ""}${job.worktree ? " · Worktree" : ""}${job.readOnly ? " · ผู้ทำงานออกแล้ว" : ""}`}
              value={STATUS_LABEL[stateOf(job.events)]}
              href={`/tasks/${job.id}`}
            />
            {tasks
              .filter((task) => task.parent === job.id)
              .map((child) => (
                <View key={child.id} style={{ marginLeft: space.xl }}>
                  <Row icon="agent" title={child.title} detail={agentName(child.agent)} value={STATUS_LABEL[stateOf(child.events)]} href={`/tasks/${child.id}`} />
                </View>
              ))}
          </View>
        ))}
      </Section>

      <Section title="ไฟล์และ repo" footer={hasRepos ? "ผู้ทำงานเขียนได้ระหว่างทำ Task ของ Project" : undefined}>
        {hasRepos ? project.repos.map((repo) => <Row key={repo} icon="branch" title={repo} detail={TEMPLATES[project.template].repos.includes(repo) && project.template !== "code" ? "Runtime สร้างให้บนเครื่อง ไม่มี remote" : undefined} />) : <Row title="ไม่มี repo" detail="งานจบในระบบอื่นผ่าน Connector" />}
      </Section>

      <Section title="wiki" footer={project.wikiWriter ? `ผู้ทำงานทุกตัวอ่านได้ เขียนได้ตัวเดียวคือ ${agentName(project.wikiWriter)} อยากแก้ให้สั่งตัวนั้น เช่น “wiki: หัวข้อ: เนื้อหา”` : "ยังไม่มีคนเขียน wiki"}>
        {project.wiki.length ? project.wiki.map((page) => <Row key={page.title} icon="file" title={page.title} detail={page.text.split("\n")[0]} onPress={() => inform(page.title, page.text)} />) : <Row title="ยังไม่มีหน้า" />}
      </Section>

      <Section title="ผู้ทำงาน" footer={canAsk ? "แชตกับ Agent หรือ Team เท่านั้น เริ่มจากตรงนี้จะเลือก Project นี้ไว้ให้ ถ้าเลือก Team ข้อความไปที่ Entry" : "คุณดูงานและ wiki ได้ แต่ถามหรือสั่งงานไม่ได้"}>
        {project.doers.map((doer) => {
          const team = doer.kind === "team" ? teams.find((candidate) => candidate.id === doer.id) : undefined;
          return (
            <Row
              key={doerKey(doer)}
              icon={doer.kind === "team" ? "members" : "agent"}
              title={doerName(doer)}
              detail={team ? `Team · Entry ${agentName(team.entry)} · ${team.employees.length} พนักงาน` : "Agent ตัวเดียว"}
              accessory={canAsk ? <Button label="เริ่มคุย" onPress={() => router.push(`/tasks/${startProjectTask(project, doer).id}`)} /> : undefined}
            />
          );
        })}
        {project.doers.length === 0 && <Row title="ยังไม่มีผู้ทำงาน" detail="คนที่มี Manage เพิ่ม Agent หรือ Team ได้ที่ตั้งค่า" />}
      </Section>

      <Card>
        <Text variant="headline">สิทธิ์ของคุณ: {RIGHT_LABEL[right]}</Text>
        <Text variant="footnote" tone="secondary">
          {RIGHT_DETAIL[right]} · {TEMPLATES[project.template].label} · อยู่บน {machines.find((machine) => machine.id === project.machineId)?.name ?? project.machineId}
        </Text>
      </Card>

      {hasRight(project, me, "manage") && (
        <Section>
          <Row icon="settings" title="ตั้งค่า Project" detail="สิทธิ์ ผู้ทำงาน path ที่ห้าม และ repo" href={`/projects/${project.id}/settings`} />
        </Section>
      )}
    </Screen>
  );
}
