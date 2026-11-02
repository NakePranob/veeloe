import { router } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { dismissNotification, PUSH_LABEL, setPushSettings, useNotifications, usePushSettings, type PushKind } from "../../../entities/notification";
import { ago } from "../../../shared/lib";
import { Empty, Icon, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

// Who each push goes to (ADR 0044), shown beside the switch so a Member knows what turning it off costs.
const WHO: Record<Exclude<PushKind, "link">, string> = {
  approval: "ส่งให้คนที่มี Approve ที่ Agent นั้น",
  turn: "ส่งให้คนที่ส่งข้อความของ Turn เมื่อไม่ได้เปิดแอปอยู่",
  budget: "ส่งให้คนที่มี Manage ตอนใช้ถึง 80% และตอนหมด",
  mention: "ส่งให้คนที่ถูกแท็ก",
  schedule: "ส่งให้คนที่ตั้ง Schedule",
  background: "ส่งให้คนที่เซ็น Idle Work หรือ Watch",
  claim: "ส่งให้คนที่มี Manage ที่ Agent นั้น",
  connector: "ส่งให้คนที่มี Manage",
  skill: "ส่งให้คนที่มี Manage",
};

// A push says only which Agent has something, never what (ADR 0005, 0044).
export function NotificationsPage() {
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  const settings = usePushSettings();
  const recent = useNotifications()
    .filter((item) => item.member === me.id)
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);
  const toggle = <K extends "kinds" | "agents">(key: K, value: string, on: boolean) =>
    setPushSettings((current) => ({ ...current, [key]: on ? (current[key] as string[]).filter((item) => item !== value) : [...(current[key] as string[]), value] }));

  return (
    <Screen title="การแจ้งเตือน">
      <Section title="ล่าสุด" footer="แจ้งเตือนที่เรื่องจบแล้ว เช่น Approval ที่มีคนตอบจากอีกเครื่อง จะหายจากทุกเครื่อง (ADR 0053)">
        {recent.length === 0 && <Empty icon="bell" title="ยังไม่มีแจ้งเตือน" detail="เมื่อ Agent ทำเสร็จ ขอ Approval หรือ Budget ใกล้หมด จะมาที่นี่ ลองสั่งงาน Agent ดู" />}
        {recent.map((item) => (
          <Row
            key={item.id}
            icon="bell"
            iconColor={item.kind === "approval" && !item.cleared ? "orange" : "secondaryLabel"}
            title={item.title}
            detail={`${PUSH_LABEL[item.kind]}${item.cleared ? " · เคลียร์แล้ว" : ""}`}
            value={ago(item.at)}
            onPress={() => {
              dismissNotification(item.id);
              router.push(item.href as never);
            }}
          />
        ))}
      </Section>

      <Section title="เรื่องที่แจ้ง" footer="ค่านี้เป็นของ Member ไม่ใช่ของเครื่อง และ sync ทุกเครื่อง ช่วงห้ามรบกวนใช้ Focus ของเครื่อง Task จาก Channel ไม่ส่ง push ยกเว้น Approval หรือถูกแท็ก (ADR 0044, 0053)">
        {(Object.keys(WHO) as (keyof typeof WHO)[]).map((kind) => (
          <ToggleRow key={kind} title={PUSH_LABEL[kind]} detail={WHO[kind]} value={!settings.kinds.includes(kind)} onChange={(on) => toggle("kinds", kind, !on)} />
        ))}
      </Section>

      <Section title="ปิดเป็นรายตัว" footer="ปิด Agent ตัวไหน จะไม่มี push ของ Agent นั้นเลย แต่ยังเห็นในหน้า Inbox">
        {agents.length === 0 && <Row title="ยังไม่มี Agent ที่คุณใช้ได้" />}
        {agents.map((agent) => (
          <ToggleRow key={agent.id} icon="agent" title={agent.name} value={!settings.agents.includes(agent.id)} onChange={(on) => toggle("agents", agent.id, !on)} />
        ))}
      </Section>
      <Note icon="shield">การแจ้งว่ามีเครื่องใหม่ถูก Link ปิดไม่ได้ เพราะเป็นทางที่คุณรู้ว่ามีคนเพิ่มเครื่องเข้าบัญชีของคุณ (ADR 0031)</Note>
    </Screen>
  );
}
