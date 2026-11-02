import { useLocalSearchParams } from "expo-router";
import { useAgents, useMachine } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { compareVersions, DRAIN_LIMIT, THIS_WORKSPACE, useUpdates, type Phase, type Run } from "../../../entities/update";
import { useRuntime } from "../../../features/demo-runtime";
import { ago, fromNow, useNow } from "../../../shared/lib";
import { Empty, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";
import { applyMinimum, foundRelease, newRelease, refusedByHub, restore, runBackup, setSignatureValid, skipWait } from "../model/update";

const STEPS: { phase: Phase; title: string; detail: string }[] = [
  { phase: "draining", title: "พักรับ Turn ใหม่ แล้วรอ Turn ที่ทำอยู่", detail: "งานที่เข้ามาต่อคิวตามปกติ Schedule ที่ถึงรอบถูกข้าม ข้อความจาก Channel ต่อคิวไปจนถึงเพดาน" },
  { phase: "verifying", title: "ตรวจลายเซ็นของ release", detail: "manifest เซ็นด้วย Ed25519 ตรวจกับกุญแจสาธารณะที่ฝังมาใน binary แล้วเทียบ SHA-256 ของไฟล์" },
  { phase: "swapping", title: "สลับไฟล์", detail: "supervisor กับ worker ใช้ binary เดียวกัน" },
  { phase: "restarting", title: "restart ทั้งเครื่อง", detail: "ผ่าน launchd หรือ systemd Turn ที่ยังเปิดอยู่จบแบบถูกขัดจังหวะ พิมพ์ ทำต่อ ได้เลย" },
];
const ORDER: Phase[] = ["draining", "verifying", "swapping", "restarting", "done"];

const MINIMUMS = ["0.1.3", "0.1.4", "0.2.0", "0.2.1"].map((value) => ({ value, label: value }));

function Steps({ run, openTurns, now }: { run: Run; openTurns: number; now: number }) {
  const at = run.phase === "failed" ? ORDER.indexOf("verifying") : ORDER.indexOf(run.phase);
  return (
    <>
      {STEPS.map((step, i) => {
        const done = i < at || run.phase === "done";
        const current = i === at && run.phase !== "done";
        const failed = run.phase === "failed" && step.phase === "verifying";
        return (
          <Row
            key={step.phase}
            icon={failed ? "failed" : done ? "done" : current ? "time" : "idle"}
            iconColor={failed ? "red" : done ? "green" : current ? "orange" : "tertiaryLabel"}
            title={step.title}
            detail={step.phase === "draining" && current ? `Turn ที่ยังทำอยู่ ${openTurns} ตัว เหลืออีก ${fromNow(run.deadline, now)} จาก ${DRAIN_LIMIT / 60_000} นาที` : step.detail}
          />
        );
      })}
    </>
  );
}

// Runtime updates itself from a signed release, and `veeloe backup` keeps what the disk holds (ADR 0009, 0033, 0051).
export function UpdatesPage() {
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachine(id);
  const me = useCurrentMember();
  const agents = useAgents();
  const runtime = useRuntime();
  const updates = useUpdates();
  const now = useNow(1000);
  const since = (at: number) => (ago(at, now) === "ตอนนี้" ? "ตอนนี้" : `${ago(at, now)} ที่แล้ว`);
  const run = updates.runs.find((candidate) => candidate.machineId === id);

  if (!machine) return <Screen title="อัปเดตและสำรอง"><Empty icon="machine" title="ไม่พบ Machine" /></Screen>;
  if (!me.owner) return <Screen title="อัปเดตและสำรอง"><Empty icon="lock" title="เฉพาะ Owner" detail="อัปเดต Runtime และ Pairing เครื่องที่กู้คืนเป็นของ Owner" /></Screen>;

  const mine = agents.filter((agent) => agent.machineId === machine.id);
  const openTurns = mine.filter((agent) => runtime.running[agent.id]).length;
  const behind = compareVersions(machine.version, updates.latest.version) < 0;
  const active = run && run.phase !== "done" && run.phase !== "failed";
  const refused = refusedByHub(machine);
  const backups = updates.backups;

  return (
    <Screen title="อัปเดตและสำรอง">
      <Section title="Runtime" footer="Hub จะไม่รับ Runtime ที่เก่ากว่าเวอร์ชันต่ำสุดที่กำหนด Runtime อัปเดตตัวเองจาก GitHub Releases ได้แม้ Hub ปฏิเสธอยู่ จึงกลับมาต่อได้เอง">
        <Row icon="machine" title={machine.name} detail={machine.os} value={machine.version} />
        <Row icon={refused ? "failed" : "done"} iconColor={refused ? "red" : "green"} title="Hub รับ Runtime รุ่นนี้" detail={refused ? `เก่ากว่าขั้นต่ำ ${updates.hubMinimum} Hub ปฏิเสธการต่อ` : `ขั้นต่ำที่ Hub รับคือ ${updates.hubMinimum}`} value={refused ? "ปฏิเสธ" : "รับ"} />
        <Row icon="download" title="release ล่าสุด" detail={`ปล่อยเมื่อ ${since(updates.latest.publishedAt)}`} value={updates.latest.version} />
      </Section>

      <Section title="อัปเดต" footer={behind || run ? "ระหว่างอัปเดต การสลับไฟล์ไม่ต้องรอให้ทุก Agent ว่างพร้อมกัน เพราะ restart กลาง Turn ปลอดภัย (ADR 0033)" : undefined}>
        {!run && !behind && <Row icon="done" iconColor="green" title="เป็นรุ่นล่าสุดแล้ว" />}
        {(!run || run.phase === "done" || run.phase === "failed") && behind && (
          <Row icon="play" title={`จำลอง: Runtime เช็กเจอ release ${updates.latest.version}`} detail="Runtime เช็กได้ตลอดและเริ่มเองเมื่อเจอ" onPress={() => { const why = foundRelease(machine); if (why) inform("ทำไม่ได้", why); }} />
        )}
        {run && <Steps run={run} openTurns={openTurns} now={now} />}
        {run?.phase === "draining" && <Row icon="demo" title="จำลอง: ครบ 30 นาที" detail="Turn ที่ยังเปิดอยู่จบแบบถูกขัดจังหวะ" onPress={() => skipWait(machine.id)} />}
        {run?.phase === "failed" && <Row icon="failed" iconColor="red" title="อัปเดตไม่สำเร็จ" detail={run.error} />}
        {run?.phase === "done" && <Row icon="done" iconColor="green" title={`อัปเดตจาก ${run.from} เป็น ${run.to} แล้ว`} detail={run.interrupted ? `${run.interrupted} Turn ถูกขัดจังหวะตอน restart เห็นในแชตของ Task นั้น` : "ไม่มี Turn ค้างตอน restart"} />}
      </Section>
      {active && <Note icon="info">ระหว่างนี้ {machine.name} ไม่เริ่ม Turn ใหม่ งานที่ส่งมาต่อคิวไว้ เริ่มหลัง restart</Note>}

      <Section title="ทดลอง" footer="จำลองฝั่ง GitHub Releases และ Hub: ปล่อยรุ่นใหม่ ทำให้ลายเซ็นผิด หรือขยับเวอร์ชันต่ำสุดที่ Hub รับ ซึ่งตัด Machine ที่เก่ากว่าทันที">
        <Row icon="demo" title="จำลอง: ปล่อย release ใหม่" onPress={newRelease} />
        <ToggleRow icon="warning" title="จำลอง: ลายเซ็นของ release ผิด" detail="การตรวจลายเซ็นต้องไม่ผ่าน และไม่สลับไฟล์" value={!updates.latest.signatureValid} onChange={(value) => setSignatureValid(!value)} />
        <Row icon="demo" title="จำลอง: Hub ขยับเวอร์ชันต่ำสุดเป็น" accessory={<Select label="เวอร์ชันต่ำสุดที่ Hub รับ" value={updates.hubMinimum} options={MINIMUMS} onChange={applyMinimum} />} />
      </Section>

      <Section
        title="สำรองและกู้คืน"
        footer="backup ไม่รวมความลับ จึงไม่ต้องมีรหัสผ่านที่คนจะลืม แต่ยังมีประวัติ Task และไฟล์งาน ต้องเก็บในที่ปลอดภัย ตั้งให้รันทุกคืนด้วย cron, launchd หรือ Time Machine และ restic"
      >
        <Row icon="logs" mono title="veeloe backup <ไฟล์>" detail="ทำสำเนา tasks.db ด้วย VACUUM INTO ระหว่างที่ระบบยังทำงาน แล้วรวมกับไฟล์อื่นเป็นไฟล์เดียว" />
        <Row icon="lock" title="ไม่รวม" detail="key ของ Provider, token ของ bot, credential ของ Connector และกุญแจของ Machine" />
        <Row icon="play" title="จำลอง: รัน veeloe backup บนเครื่องนี้" onPress={() => runBackup(machine)} />
      </Section>
      <Section
        title="veeloe restore <ไฟล์>"
        footer={`ใช้บนเครื่องใหม่ที่ยังไม่ได้ Pairing แล้ว Owner Pairing ตามปกติ ถ้า Workspace ตรงกับใน backup แอปถามว่าเครื่องนี้แทน Machine เดิมหรือเปล่า backup ของ Workspace อื่นใช้ไม่ได้ ผลลัพธ์จะเกิดกับ ${machine.name}`}
      >
        {backups.map((backup) => (
          <Row
            key={backup.id}
            icon="download"
            title={backup.machineName}
            detail={`${backup.workspace === THIS_WORKSPACE ? "Workspace นี้" : `Workspace ${backup.workspace}`} · ${backup.agents} Agent · ${backup.tasks} Task · ${since(backup.at)}`}
            value="กู้คืน"
            onPress={async () => {
              const why = await restore(me, machine, backup);
              if (why) inform("กู้คืนไม่ได้", why);
            }}
          />
        ))}
      </Section>
      <Note>หลังกู้ต้อง login Connector และใส่ key ของ Provider กับ token ของ bot ใหม่ สิ่งที่เกิดหลัง backup ครั้งล่าสุดหายไป</Note>
    </Screen>
  );
}
