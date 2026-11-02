import { useLocalSearchParams } from "expo-router";
import { useAgent } from "../../../entities/agent";
import { removeThread, useAutomation } from "../../../entities/automation";
import { can, useCurrentMember } from "../../../entities/member";
import { preview, stateOf, STATUS_LABEL, useTasks, type Task } from "../../../entities/task";
import { canRead } from "../../../features/access";
import { confirm, Empty, Note, Row, Screen, Section } from "../../../shared/ui";

const when = (at: number) => new Date(at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The Tasks one Schedule, Watch or Idle Work list opened, by time. It is an index only: the
// Tasks stay as they are, and deleting the thread leaves them (ADR 0061).
export function ThreadPage() {
  const { origin } = useLocalSearchParams<{ origin: string }>();
  const { threads, schedules, lists, watches } = useAutomation();
  const thread = threads.find((candidate) => candidate.origin === origin);
  const source = [...schedules, ...lists, ...watches].find((candidate) => candidate.id === origin);
  const agent = useAgent(thread?.agent ?? source?.agent);
  const me = useCurrentMember();
  const tasks = useTasks().filter((task) => task.origin === origin);

  if (!thread) {
    return (
      <Screen title="เส้นร้อย Task">
        <Empty icon="thread" title={tasks.length ? "เส้นนี้ถูกลบแล้ว" : "ไม่พบเส้นนี้"} detail={tasks.length ? `Task ${tasks.length} อันยังอยู่ที่ Agent เส้นจะกลับมาเมื่อรอบถัดไปเปิด Task` : undefined} />
      </Screen>
    );
  }
  if (agent && !can(me, agent.id, "use")) return <Screen title="เส้นร้อย Task"><Note icon="lock">ดูเส้นนี้ได้เฉพาะคนที่มี Use ที่ {agent.name}</Note></Screen>;

  const rows = tasks.filter((task) => canRead(me, task)).sort((a, b) => (b.events[0]?.at ?? 0) - (a.events[0]?.at ?? 0));
  const quiet = rows.filter((task) => task.silent).length;
  const link = source ? (thread.kind === "schedule" ? `/automation/schedules/${origin}` : thread.kind === "idle" ? `/automation/idle/${origin}` : `/automation/watches/${origin}`) : undefined;

  const remove = async () => {
    if (!(await confirm({ title: "ลบเส้นนี้?", message: "ลบแค่สารบัญ Task ทุกอันยังอยู่ และเส้นจะกลับมาเมื่อรอบถัดไปเปิด Task", action: "ลบเส้น", destructive: true }))) return;
    removeThread(origin);
  };

  return (
    <Screen title="เส้นร้อย Task">
      <Section title={thread.title} footer="เส้นเป็นแค่สารบัญของ Task จากต้นกำเนิดเดียวกัน รอบที่เงียบก็ขึ้นที่นี่ เพื่อให้เห็นว่าเช็กแล้ว ไม่ได้ขาดหาย">
        <Row icon="agent" title={agent?.name ?? thread.agent} detail={`${rows.length} รอบ · ${rows.length - quiet} มีเรื่อง · ${quiet} เงียบ`} />
        {link ? <Row icon={thread.kind === "schedule" ? "schedule" : thread.kind === "idle" ? "idle" : "watch"} title={thread.kind === "schedule" ? "เปิด Schedule" : thread.kind === "idle" ? "เปิดลิสต์ Idle Work" : "เปิด Watch"} href={link} /> : <Row icon="info" title="ต้นกำเนิดถูกลบแล้ว" detail="Task กับเส้นยังอยู่" />}
      </Section>
      <Section title="รอบ">
        {rows.length === 0 && <Row title="ยังไม่มีรอบที่คุณเปิดดูได้" />}
        {rows.map((task) => <Round key={task.id} task={task} />)}
      </Section>
      <Section>
        <Row icon="trash" title="ลบเส้นนี้" detail="ลบแค่สารบัญ ไม่ลบ Task" destructive onPress={remove} />
      </Section>
    </Screen>
  );
}

function Round({ task }: { task: Task }) {
  const state = stateOf(task.events);
  const summary = task.silent ? "ไม่มีอะไร" : preview(task.events) || task.title;
  return (
    <Row
      icon={task.silent ? "done" : "bell"}
      iconColor={task.silent ? "secondaryLabel" : "green"}
      title={summary}
      detail={`${when(task.events[0]?.at ?? 0)}${state === "done" ? "" : ` · ${STATUS_LABEL[state]}`}`}
      value={task.silent ? "เงียบ" : "มีเรื่อง"}
      href={`/tasks/${task.id}`}
    />
  );
}
