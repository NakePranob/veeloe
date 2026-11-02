import { router, useLocalSearchParams } from "expo-router";
import { useAgent } from "../../../entities/agent";
import { CADENCES, updateAutomation, useAutomation } from "../../../entities/automation";
import { can, memberName, useCurrentMember } from "../../../entities/member";
import { setMachineOnline } from "../../../features/demo-runtime";
import { confirm, Empty, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";
import { canOperate, catchUpSchedule, deleteAutomation, RunLogSection, runSchedule, SignedSection, ThreadRow, useProblem, when, type Outcome } from "../../../widgets/background-work";

export function SchedulePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schedule = useAutomation().schedules.find((candidate) => candidate.id === id);
  const agent = useAgent(schedule?.agent);
  const me = useCurrentMember();
  if (!schedule || !agent) return <Screen title="Schedule"><Empty icon="schedule" title="ไม่พบ Schedule นี้" detail="อาจถูกลบแล้ว Task ที่เคยเปิดยังอยู่ในเส้นร้อย" /></Screen>;
  if (!can(me, agent.id, "use")) return <Screen title="Schedule"><Note icon="lock">ดู Schedule นี้ได้เฉพาะคนที่มี Use ที่ {agent.name}</Note></Screen>;
  return <Detail id={schedule.id} />;
}

function Detail({ id }: { id: string }) {
  const schedule = useAutomation().schedules.find((candidate) => candidate.id === id)!;
  const agent = useAgent(schedule.agent)!;
  const me = useCurrentMember();
  const problem = useProblem(schedule);
  const mine = canOperate(me, schedule.signedBy, agent.id);
  const cadence = CADENCES.find((item) => item.value === schedule.cadence);
  const report = (title: string, outcome: Outcome) => {
    if (!outcome.ok) inform(title, outcome.message);
  };

  const remove = async () => {
    if (!(await confirm({ title: "ลบ Schedule นี้?", message: "Task ที่เคยเปิดยังอยู่ และเส้นร้อยยังอยู่ในแอป", action: "ลบ", destructive: true }))) return;
    deleteAutomation("schedules", id);
    router.back();
  };

  return (
    <Screen title="Schedule">
      <Section title="ข้อความ">
        <Row title={schedule.message} detail={`${cadence?.label ?? schedule.cadence} · ${agent.name}`} />
        <Row icon="bell" title={schedule.notify === "everyone" ? "แจ้งทุกคนที่มี Use" : `แจ้ง ${memberName(schedule.signedBy)} คนเดียว`} detail="เฉพาะรอบที่มีเรื่องจะบอก รอบที่เงียบไม่ push และไม่ขึ้น Inbox" />
        <Row icon="time" title={schedule.lastRunAt ? `รันล่าสุด ${when(schedule.lastRunAt)}` : "ยังไม่เคยรัน"} value={problem ? "หยุด" : schedule.paused ? "พักไว้" : "ทำงานอยู่"} />
        {schedule.missed && <Row icon="time" iconColor="orange" title={`พลาด ${schedule.missed.count} รอบเพราะ ${agent.machine.name} ปิดอยู่`} detail="จะรันชดเชยครั้งเดียวตอนเครื่องกลับมา และบอก Agent ว่ารอบนั้นควรรันตอนกี่โมง" />}
      </Section>

      <SignedSection item={schedule} kind="schedules" />
      <ThreadRow origin={id} />

      {mine && (
        <Section title="ควบคุม" footer="ถึงรอบแล้วถ้า Agent ยังไม่ว่าง รอบนั้นถูกข้าม ไม่ต่อคิว เพราะกว่าจะถึงคิวผลก็เก่าแล้ว">
          {/* ponytail: stands in for the Runtime's clock reaching the time; the round then follows the same rules. */}
          <Row icon="play" title="รันรอบนี้เลย" detail="เหมือนถึงเวลาตามที่ตั้งไว้ และทำในนามของคนเซ็น" onPress={() => report("ไม่ได้รันรอบนี้", runSchedule(id))} />
          <ToggleRow icon="time" title="พักไว้" detail="ข้ามทุกรอบจนกว่าจะเปิดอีกครั้ง" value={schedule.paused} onChange={(paused) => updateAutomation("schedules", id, { paused })} />
          <Row icon="trash" title="ลบ Schedule" destructive onPress={remove} />
        </Section>
      )}

      {mine && (
        <Section title="จำลอง" footer="สิ่งที่ในระบบจริงเกิดจากนาฬิกาและสถานะของ Machine">
          <Row icon="demo" title="จำลอง: รอบที่ไม่มีอะไรต้องบอก" detail="Agent จบ Turn โดยไม่แจ้งใคร Task ไม่ขึ้น Inbox แต่ยังอยู่ในเส้นร้อย" onPress={() => report("ไม่ได้รันรอบนี้", runSchedule(id, { quiet: true }))} />
          <Row icon="demo" title="จำลอง: Machine ปิดข้ามไป 3 รอบ แล้วกลับมา" detail="รันชดเชยครั้งเดียว พร้อมเวลาที่รอบแรกควรรัน" onPress={() => report("ไม่ได้รันรอบชดเชย", catchUpSchedule(id, 3))} />
          <ToggleRow icon="machine" title={`${agent.machine.name} เปิดอยู่`} detail="ปิดแล้วกด รันรอบนี้เลย จะนับเป็นรอบที่พลาด เปิดอีกครั้งจะรันชดเชยเอง" value={agent.machine.online} onChange={(online) => setMachineOnline(agent.machineId, online)} />
        </Section>
      )}

      <RunLogSection log={schedule.log} />
    </Screen>
  );
}
