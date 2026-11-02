import { router, useLocalSearchParams } from "expo-router";
import { useAgent } from "../../../entities/agent";
import { updateAutomation, useAutomation, type Watch } from "../../../entities/automation";
import { can, memberName, useCurrentMember } from "../../../entities/member";
import { setMachineOnline } from "../../../features/demo-runtime";
import { confirm, Empty, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";
import { canOperate, deleteAutomation, MAX_WAIT_MINUTES, RunLogSection, SignedSection, ThreadRow, useCeiling, useProblem, watchAfterOff, watchChange, watchOwnWrite, watchWait, when, type Outcome } from "../../../widgets/background-work";

export function WatchPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const watch = useAutomation().watches.find((candidate) => candidate.id === id);
  const agent = useAgent(watch?.agent);
  const me = useCurrentMember();
  if (!watch || !agent) return <Screen title="Watch"><Empty icon="watch" title="ไม่พบ Watch นี้" /></Screen>;
  if (!can(me, agent.id, "use")) return <Screen title="Watch"><Note icon="lock">ดู Watch นี้ได้เฉพาะคนที่มี Use ที่ {agent.name}</Note></Screen>;
  return <Detail id={watch.id} />;
}

function Detail({ id }: { id: string }) {
  const watch = useAutomation().watches.find((candidate) => candidate.id === id) as Watch;
  const agent = useAgent(watch.agent)!;
  const me = useCurrentMember();
  const problem = useProblem(watch);
  const ceiling = useCeiling(agent.id);
  const mine = canOperate(me, watch.signedBy, agent.id);
  const pending = watch.pending;
  const say = (outcome: Outcome) => {
    if (!outcome.ok) inform("ไม่เริ่มงาน", outcome.message);
  };

  const remove = async () => {
    if (!(await confirm({ title: "ลบ Watch นี้?", message: "Task ที่เคยเปิดยังอยู่ และเส้นร้อยยังอยู่ในแอป", action: "ลบ", destructive: true }))) return;
    deleteAutomation("watches", id);
    router.back();
  };

  return (
    <Screen title="Watch">
      <Section title="เฝ้าอะไร">
        <Row icon="watch" title={watch.path} mono detail={`${watch.on === "new" ? "มีไฟล์ใหม่" : "ไฟล์เปลี่ยน"} · ${agent.name}`} value={problem ? "หยุด" : watch.paused ? "พักไว้" : "ทำงานอยู่"} />
        <Row icon="list" title={watch.action} detail={`${watch.proposedBy === "agent" ? "Agent เสนอ" : "Member ตั้ง"} · ${memberName(watch.signedBy)} เซ็น`} />
        <Row icon="time" title={`รวม event: รอเงียบ ${watch.debounceMinutes} นาที สูงสุด ${MAX_WAIT_MINUTES} นาที`} detail={watch.lastRunAt ? `เปิดงานล่าสุด ${when(watch.lastRunAt)}` : "ยังไม่เคยเปิดงาน"} />
        {ceiling && <Row icon="usage" iconColor={ceiling.reached ? "red" : "secondaryLabel"} title="เพดานของงานพื้นหลังวันนี้" detail={`${ceiling.used.toLocaleString("en-US")} จาก ${ceiling.limit.toLocaleString("en-US")} token รวม Idle Work กับ Watch${ceiling.reached ? " · ถึงเพดานแล้ว" : ""}`} />}
        {pending && <Row icon="branch" iconColor="orange" title={`รอรวมอยู่ ${pending.count} event`} detail={`เงียบมา ${pending.quiet} จาก ${watch.debounceMinutes} นาที · รอมา ${pending.span} จาก ${MAX_WAIT_MINUTES} นาที`} />}
        {watch.changedWhileOff && <Row icon="machine" iconColor="orange" title={`ไฟล์เปลี่ยนตอน ${agent.machine.name} ปิด`} detail="Runtime จะเทียบไฟล์ตอนเครื่องกลับมา แล้วเริ่มงานครั้งเดียว" />}
      </Section>

      <SignedSection item={watch} kind="watches" />
      <ThreadRow origin={id} />

      {mine && (
        <Section title="ควบคุม">
          <ToggleRow icon="time" title="พักไว้" detail="ไม่เปิดงานจนกว่าจะเปิดอีกครั้ง" value={watch.paused} onChange={(paused) => updateAutomation("watches", id, { paused })} />
          <Row icon="trash" title="ลบ Watch" destructive onPress={remove} />
        </Section>
      )}

      {mine && (
        <Section title="จำลอง" footer="ในระบบจริง Runtime เห็นไฟล์เปลี่ยนเอง ไม่ผ่าน Hub แต่ละปุ่มคือสิ่งที่ Runtime เห็นแล้วใช้กฎของ ADR 0057">
          {/* ponytail: file events and the passing of time are buttons; merging, the 30-minute cap and the ceiling are the real rules. */}
          <Row icon="demo" title="จำลอง: ไฟล์เปลี่ยน" detail="หนึ่ง event รอให้ไฟล์เงียบก่อนเริ่มงาน" onPress={() => say(watchChange(id, 1, "changed"))} />
          <Row icon="demo" title="จำลอง: มีไฟล์ใหม่" onPress={() => say(watchChange(id, 1, "new"))} />
          <Row icon="demo" title="จำลอง: ไฟล์เปลี่ยนถี่ 10 ครั้งใน 2 นาที" detail="รวมเป็นงานเดียว" onPress={() => say(watchChange(id, 10, watch.on))} />
          <Row icon="demo" title={`จำลอง: เงียบไป ${watch.debounceMinutes} นาที`} detail="เงียบครบเวลาแล้วเริ่มงานที่รวมไว้" onPress={() => say(watchWait(id, watch.debounceMinutes))} />
          <Row icon="demo" title="จำลอง: ไฟล์เปลี่ยนไม่หยุด 30 นาที" detail="เช่นไฟล์ log เริ่มงานที่ 30 นาทีโดยไม่รอเงียบ" onPress={() => { const first = watchChange(id, 1, watch.on); if (!first.ok) return say(first); say(watchWait(id, MAX_WAIT_MINUTES, true)); }} />
          <Row icon="demo" title="จำลอง: Agent เขียนไฟล์ที่เฝ้าอยู่เอง" detail="ไม่นับเป็น event ไม่อย่างนั้น Agent จะปลุกตัวเองไม่จบ" onPress={() => say(watchOwnWrite(id))} />
          <Row icon="demo" title="จำลอง: ไฟล์เปลี่ยนตอน Machine ปิด แล้วเครื่องกลับมา" detail="เทียบไฟล์ตอนกลับมา แล้วเริ่มงานครั้งเดียว" onPress={() => say(watchAfterOff(id))} />
          <ToggleRow icon="machine" title={`${agent.machine.name} เปิดอยู่`} detail="ปิดแล้วกด จำลอง: ไฟล์เปลี่ยน จะเก็บไว้เทียบตอนเครื่องกลับมา" value={agent.machine.online} onChange={(online) => setMachineOnline(agent.machineId, online)} />
        </Section>
      )}

      <RunLogSection log={watch.log} />
    </Screen>
  );
}
