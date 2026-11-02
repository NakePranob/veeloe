import { router, useLocalSearchParams } from "expo-router";
import { useAgent } from "../../../entities/agent";
import { RULE_LABEL, updateAutomation, useAutomation, type IdleItem } from "../../../entities/automation";
import { can, useCurrentMember } from "../../../entities/member";
import { newTask, sendMessage } from "../../../features/demo-runtime";
import { confirm, Empty, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";
import { canOperate, deleteAutomation, RunLogSection, retryItem, SignedSection, ThreadRow, useCeiling, useProblem, wakeIdle, when } from "../../../widgets/background-work";

const STATUS: Record<IdleItem["status"], { label: string; icon: "list" | "done" | "stopped" | "approval"; color: "secondaryLabel" | "green" | "red" | "orange" }> = {
  todo: { label: "รอทำ", icon: "list", color: "secondaryLabel" },
  done: { label: "เสร็จ", icon: "done", color: "green" },
  unfinished: { label: "ไม่เสร็จ", icon: "stopped", color: "red" },
  skipped: { label: "ข้าม: ต้องขอ Approval", icon: "approval", color: "orange" },
};

export function IdleWorkPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useAutomation().lists.find((candidate) => candidate.id === id);
  const agent = useAgent(list?.agent);
  const me = useCurrentMember();
  if (!list || !agent) return <Screen title="Idle Work"><Empty icon="idle" title="ไม่พบลิสต์นี้" /></Screen>;
  if (!can(me, agent.id, "use")) return <Screen title="Idle Work"><Note icon="lock">ดูลิสต์นี้ได้เฉพาะคนที่มี Use ที่ {agent.name}</Note></Screen>;
  return <Detail id={list.id} />;
}

function Detail({ id }: { id: string }) {
  const list = useAutomation().lists.find((candidate) => candidate.id === id)!;
  const agent = useAgent(list.agent)!;
  const me = useCurrentMember();
  const problem = useProblem(list);
  const ceiling = useCeiling(agent.id);
  const mine = canOperate(me, list.signedBy, agent.id);
  const retryable = list.items.filter((item) => item.status === "unfinished" || item.status === "skipped");

  const remove = async () => {
    if (!(await confirm({ title: "ลบลิสต์นี้?", message: "Task ที่เคยเปิดยังอยู่ และเส้นร้อยยังอยู่ในแอป", action: "ลบ", destructive: true }))) return;
    deleteAutomation("lists", id);
    router.back();
  };

  // A person writing to the Agent: it queues like any message and never interrupts the work (ADR 0056).
  const typeToAgent = () => {
    const task = newTask(agent.id);
    sendMessage(task.id, "ช่วยดูสถานะงานล่าสุดหน่อย", "low");
    inform("ส่งข้อความแล้ว", "ถ้า Idle Work กำลังทำอยู่ ข้อความนี้ต่อคิวรอ ไม่ขัดงานกลางคัน");
  };

  return (
    <Screen title="Idle Work">
      <Section title={list.name}>
        <Row icon="agent" title={agent.name} detail={list.proposedBy === "agent" ? "Agent เสนอ Member อ่านร่างเต็มแล้วเซ็น" : "Member เขียนเอง"} value={problem ? "หยุด" : list.paused ? "พักไว้" : "ทำงานอยู่"} />
        <Row icon="idle" title={`ปลุกเมื่อเงียบ ${list.quietMinutes} นาที`} detail={`ไม่มี Turn กำลังทำ และคิวว่าง · ${list.order === "fixed" ? "ลำดับตายตัว" : `กฎที่เซ็น: ${RULE_LABEL[list.rule]}`} · ชิ้นละไม่เกิน ${list.capMinutes} นาที`} />
        <Row icon="time" title={list.lastRunAt ? `ปลุกล่าสุด ${when(list.lastRunAt)}` : "ยังไม่เคยปลุก"} />
        {ceiling && (
          <Row
            icon="usage"
            iconColor={ceiling.reached ? "red" : "secondaryLabel"}
            title="เพดานของงานพื้นหลังวันนี้"
            detail={`${ceiling.used.toLocaleString("en-US")} จาก ${ceiling.limit.toLocaleString("en-US")} token รวม Idle Work กับ Watch${ceiling.reached ? " · ถึงเพดานแล้ว" : ""}`}
          />
        )}
      </Section>

      <Section title="งานในลิสต์" footer="ชิ้นที่ต้องขอ Approval ถูกจดไว้และข้ามไป ไม่ถือ Agent รอ ชิ้นที่เกินเพดานเวลาไม่เสร็จ ลองใหม่ได้เมื่อพร้อม">
        {list.items.map((item, index) => (
          <Row key={item.id} icon={STATUS[item.status].icon} iconColor={STATUS[item.status].color} title={`${index + 1}. ${item.text}`} detail={`ราว ${item.minutes} นาที`} value={STATUS[item.status].label} />
        ))}
        {mine && retryable.map((item) => <Row key={`retry-${item.id}`} icon="restart" title={`ลองใหม่: ${item.text}`} onPress={() => retryItem(id, item.id)} />)}
      </Section>

      <SignedSection item={list} kind="lists" />
      <ThreadRow origin={id} />

      {mine && (
        <Section title="ควบคุม">
          <ToggleRow icon="time" title="พักไว้" detail="ไม่ปลุก Agent จนกว่าจะเปิดอีกครั้ง" value={list.paused} onChange={(paused) => updateAutomation("lists", id, { paused })} />
          <Row icon="trash" title="ลบลิสต์" destructive onPress={remove} />
        </Section>
      )}

      {mine && (
        <Section title="จำลอง" footer="ในระบบจริง Runtime นับความเงียบเอง ปุ่มนี้ข้ามไปที่ตอนเงียบครบเวลาแล้ว">
          {/* ponytail: the quiet timer is a button; the checks that follow are the real ones. */}
          <Row icon="demo" title={`จำลอง: เงียบครบ ${list.quietMinutes} นาทีแล้ว`} detail="ปลุกได้ก็ต่อเมื่อไม่มี Turn กำลังทำและคิวว่าง" onPress={() => { const outcome = wakeIdle(id); if (!outcome.ok) inform("ไม่ปลุก Agent", outcome.message); }} />
          <Row icon="demo" title="จำลอง: มีคนส่งข้อความหา Agent" detail="ข้อความต่อคิวตามปกติ ไม่ขัดงานชิ้นที่ทำอยู่ ลองกดหลังปลุกทันทีเพื่อดูว่า Agent ไม่ว่าง" onPress={typeToAgent} />
        </Section>
      )}

      <RunLogSection log={list.log} />
    </Screen>
  );
}
