import { useLocalSearchParams } from "expo-router";
import { charge, useAgents } from "../../../entities/agent";
import { useAutomation } from "../../../entities/automation";
import { can, useCurrentMember } from "../../../entities/member";
import { AutomationRow, backgroundToday } from "../../../widgets/background-work";
import { Empty, inform, Note, Row, Screen, Section } from "../../../shared/ui";

// What the Agents do without being asked, for every Member with Use (ADR 0057). Each line is
// something a Member signed, and says who, whether it runs, and when it last did.
export function AutomationPage() {
  const { agent: filter } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  const { schedules, lists, watches } = useAutomation();
  const only = agents.find((agent) => agent.id === filter)?.id;
  const visible = (agentId: string) => (only ? agentId === only : agents.some((agent) => agent.id === agentId));
  const shown = agents.filter((agent) => !only || agent.id === only);
  const add = (path: string) => (only ? `${path}?agent=${only}` : path);

  if (agents.length === 0) return <Screen title="งานพื้นหลัง"><Empty icon="schedule" title="ยังไม่มี Agent ที่คุณมี Use" detail="งานพื้นหลังเห็นได้เฉพาะ Member ที่มี Use ที่ Agent นั้น" /></Screen>;

  return (
    <Screen title="งานพื้นหลัง">
      <Note>Schedule, Idle Work และ Watch คือสิ่งที่ Member เซ็นให้ Agent ทำเองโดยไม่มีใครสั่ง ทุกคนที่มี Use ที่ Agent นั้นดูได้</Note>

      <Section title="Schedule" footer="ข้อความที่ตั้งเวลาไว้ ทุกรอบเปิด Task ใหม่ ถ้าไม่มีอะไรต้องบอกจะไม่ขึ้น Inbox">
        {schedules.filter((item) => visible(item.agent)).map((item) => <AutomationRow key={item.id} kind="schedules" item={item} />)}
        {!schedules.some((item) => visible(item.agent)) && <Row title="ยังไม่มี Schedule" />}
        <Row icon="add" title="ตั้ง Schedule ใหม่" href={add("/automation/schedule-new")} />
      </Section>

      <Section title="Idle Work" footer="ลิสต์งานที่ Agent ทำเองเมื่อไม่มี Turn กำลังทำ คิวว่าง และเงียบครบเวลาที่ตั้ง">
        {lists.filter((item) => visible(item.agent)).map((item) => <AutomationRow key={item.id} kind="lists" item={item} />)}
        {!lists.some((item) => visible(item.agent)) && <Row title="ยังไม่มีลิสต์" />}
        <Row icon="add" title="สร้างลิสต์ Idle Work" href={add("/automation/idle-new")} />
      </Section>

      <Section title="Watch" footer="เปิดงานเมื่อไฟล์ในเครื่องเปลี่ยนหรือมีไฟล์ใหม่ ในที่ที่คนตั้งอ่านได้">
        {watches.filter((item) => visible(item.agent)).map((item) => <AutomationRow key={item.id} kind="watches" item={item} />)}
        {!watches.some((item) => visible(item.agent)) && <Row title="ยังไม่มี Watch" />}
        <Row icon="add" title="ตั้ง Watch ใหม่" href={add("/automation/watch-new")} />
      </Section>

      <Section title="เพดานของงานพื้นหลังวันนี้" footer="Idle Work กับ Watch ใช้ token รวมกันได้ไม่เกินเพดานนี้ งานของคนยังใช้ Budget ได้เต็ม คนที่มี Manage ตั้งเพดานที่หน้า Agent">
        {shown.map((agent) => {
          const used = backgroundToday(agent);
          const limit = Math.floor((agent.budget * agent.backgroundPercent) / 100);
          return (
            <Row
              key={agent.id}
              icon="usage"
              iconColor={used >= limit ? "red" : "secondaryLabel"}
              title={agent.name}
              detail={`${used.toLocaleString("en-US")} จาก ${limit.toLocaleString("en-US")} token (${agent.backgroundPercent}% ของ Budget)${used >= limit ? " · ถึงเพดานแล้ว งานใหม่ไม่เริ่ม" : ""}`}
              value={`${Math.min(100, Math.round((used / Math.max(1, limit)) * 100))}%`}
            />
          );
        })}
        {shown.filter((agent) => can(me, agent.id, "manage")).map((agent) => (
          // ponytail: spends tokens as Idle Work would, so the ceiling can be reached without waiting for real work.
          <Row key={`spend-${agent.id}`} icon="demo" title={`จำลอง: ${agent.name} ใช้ token พื้นหลังเพิ่ม 1M`} onPress={() => { charge(agent.id, me.id, "Idle Work", 1_000_000); inform("เพิ่มแล้ว", "นับเป็นการใช้ของ Idle Work วันนี้ ลองปลุก Idle Work หรือ Watch ต่อเพื่อดูว่าเริ่มไม่ได้เมื่อถึงเพดาน"); }} />
        ))}
      </Section>
      <Note icon="lock">ถ้ากุญแจที่เซ็นถูกถอน หรือ Member ที่เซ็นถูกลบ งานนั้นหยุดทันที ผู้เซ็นหรือ Owner เซ็นใหม่ได้จากกุญแจที่ยังใช้ได้</Note>
    </Screen>
  );
}
