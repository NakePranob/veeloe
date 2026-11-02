import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAgents, useMachine } from "../../../entities/agent";
import { useCurrentMember, useMembers } from "../../../entities/member";
import { dropRelease, RELEASE_TTL, useMovedOf, useRelease } from "../../../entities/release";
import { useTasks } from "../../../entities/task";
import { useNow } from "../../../shared/lib";
import { Empty, inform, Note, Row, Screen, Section } from "../../../shared/ui";
import { cancelRelease, expireRelease, moveSummary, pairElsewhere, release } from "../model/release";

const DAY = 86_400_000;

// Moving a Machine to another Workspace: this Workspace's Owner signs a release, then the new
// Workspace's Owner pairs at the Machine (ADR 0035).
export function ReleasePage() {
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachine(id);
  const found = useRelease(id);
  const moved = useMovedOf(id);
  const me = useCurrentMember();
  useAgents();
  useMembers();
  useTasks();
  // Re-renders each minute so the days left stay true while the page is open.
  useNow(60_000);
  const run = async (promise: Promise<string | null>) => {
    const why = await promise;
    if (why) inform("ทำไม่ได้", why);
  };

  // The cancel reaches a Machine that was off as soon as it connects again.
  useEffect(() => {
    if (found?.cancelPending && machine?.online) dropRelease(found.machineId);
  }, [found, machine?.online]);

  if (moved) {
    return (
      <Screen title="ย้าย Machine">
        <Section title={`${moved.machineName} ย้ายไป Workspace ใหม่แล้ว`} footer="Machine ไม่ได้อยู่ใน Workspace นี้อีก โฟลเดอร์ของ Agent เดิมยังอยู่บนดิสก์ของเครื่อง แต่ Agent ตัวไหนใน Workspace นี้ก็อ่านไม่ได้">
          <Row icon="done" iconColor="green" title="ย้ายไปพร้อมเครื่อง" detail={`Agent ${moved.agents.join(", ") || "ไม่มี"} · ${moved.tasks} Task ที่ประวัติแสดงคนสั่งเป็น Member ของ Workspace เดิม`} />
          <Row icon="trash" title="ล้างแล้ว" detail={`Grant ${moved.grants} รายการ และ credential ของ Connector ทั้งหมด`} />
          <Row icon="time" title="หยุดแล้ว" detail="Schedule และ Channel ผูก Channel ใหม่ได้ทันทีเพราะ token ของ bot ยังอยู่ที่ supervisor" />
        </Section>
      </Screen>
    );
  }
  if (!machine) return <Screen title="ย้าย Machine"><Empty icon="machine" title="ไม่พบ Machine" /></Screen>;
  if (!me.owner) return <Screen title="ย้าย Machine"><Empty icon="lock" title="เฉพาะ Owner" detail="การปล่อย Machine ไปอยู่ Workspace อื่นเป็นของ Owner" /></Screen>;

  const { agents, tasks, grants } = moveSummary(machine);
  const expired = !!found && Date.now() >= found.expiresAt;
  const days = found ? Math.max(0, Math.ceil((found.expiresAt - Date.now()) / DAY)) : 0;

  return (
    <Screen title="ย้าย Machine" right={!found || expired ? { label: "เซ็นปล่อย", onPress: () => run(release(me, machine)) } : undefined}>
      <Note icon="warning" iconColor="orange">
        Workspace ใหม่จะเห็นทุกอย่างบนเครื่องนี้ ทั้ง Agent, Workdir, Memory, Skill, Library, Project และประวัติ Task ของคุณ ย้ายได้ทั้งเครื่องเท่านั้น ถ้าไม่อยากให้ Agent ตัวไหนย้ายไป ให้ลบตัวนั้นก่อนปล่อย
      </Note>

      {found && !expired && (
        <Section title="ปล่อยแล้ว" footer="ใช้ได้กับ Pairing ครั้งถัดไปครั้งเดียว ระหว่างที่ปล่อยอยู่ Machine ยังทำงานใน Workspace นี้ตามปกติ">
          <Row icon="time" iconColor="orange" title={`เหลืออีก ${days} วัน`} detail={`หมดอายุใน ${RELEASE_TTL / DAY} วันนับจากที่เซ็น`} />
          {found.cancelPending && <Row icon="info" title="ส่งคำสั่งยกเลิกแล้ว รอ Machine ออนไลน์" detail="ถ้ามีคน Pair ก่อนที่เครื่องจะได้รับ การย้ายจะสำเร็จ" />}
          {!found.cancelPending && <Row icon="failed" destructive title="ยกเลิกการปล่อย" detail="Owner คนไหนก็ยกเลิกได้ด้วยคำสั่งที่เซ็น" onPress={() => run(cancelRelease(me, machine))} />}
        </Section>
      )}
      {found && expired && (
        <Section title="คำสั่งปล่อยหมดอายุ" footer="คำสั่งที่ลืมไปแล้วจึงไม่เป็นช่องให้คนที่เข้าเครื่องได้เอาเครื่องไป Pairing กับ Workspace ของตัวเอง">
          <Row icon="failed" iconColor="red" title="ใช้ไม่ได้แล้ว" detail="เซ็นใหม่ที่ปุ่มมุมขวาบน" />
        </Section>
      )}

      <Section title="ย้ายไปด้วย" footer="Agent, Workdir, Memory, Skill, Library, Project และประวัติ Task Owner ใหม่ได้ Manage ที่ทุก Agent ตามกฎของ Owner แล้วค่อยแจกให้คนอื่น">
        {agents.length === 0 && <Row icon="info" title="ไม่มี Agent บนเครื่องนี้" />}
        {agents.map((agent) => <Row key={agent.id} icon="agent" title={agent.name} detail={agent.description} />)}
        <Row icon="thread" title="Task" value={`${tasks}`} />
      </Section>
      <Section title="ถูกล้าง" footer="กุญแจของ Controller ทุกตัวใน Workspace เดิมถูกตัดออก ประวัติ Task เดิมแสดงคนสั่งเป็น Member ของ Workspace เดิม">
        <Row icon="key" title="Grant ทั้งหมด" detail="อ้างถึง Member ของที่เก่า" value={`${grants}`} />
        <Row icon="connector" title="credential ของ Connector" detail="ไม่อย่างนั้น Workspace ใหม่จะได้ใช้บัญชีขององค์กรเดิม" />
      </Section>
      <Section title="หยุด" footer="กุญแจที่เซ็นไว้ไม่ได้รับความไว้ใจแล้ว แต่ token ของ bot ยังอยู่ที่ supervisor จึงผูก Channel ใหม่ได้ทันที">
        <Row icon="schedule" title="Schedule" />
        <Row icon="channel" title="Channel" />
      </Section>

      {found && !expired && (
        <Section title="ทดลอง" footer="Pairing จริงทำที่หน้าเครื่อง โดย Owner ของ Workspace ใหม่แลกกุญแจผ่าน QR บนจอ Machine Hub ไม่เคยเป็นคนส่งกุญแจ">
          <Row icon="demo" title="จำลอง: Owner ฝั่งใหม่ Pair ที่เครื่อง" detail="Machine จะออกจาก Workspace นี้ (โหลดแอปใหม่เพื่อกลับมา)" onPress={() => run(pairElsewhere(me, machine))} />
          <Row icon="demo" title="จำลอง: ผ่านไป 7 วัน" onPress={() => expireRelease(machine.id)} />
        </Section>
      )}
    </Screen>
  );
}
