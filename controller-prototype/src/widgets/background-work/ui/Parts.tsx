import { useAgent } from "../../../entities/agent";
import { CADENCES, type IdleList, type RunKind, type RunLog, type Schedule, type Watch } from "../../../entities/automation";
import { getMembers, memberName, useCurrentMember } from "../../../entities/member";
import { useTasks } from "../../../entities/task";
import { canResign, useStoppedReason } from "../../../features/signing";
import { ago } from "../../../shared/lib";
import { authenticate, inform, Note, Row, Section, type IconName } from "../../../shared/ui";
import { resign, watchProblem } from "../model/runner";

type Kind = "schedules" | "lists" | "watches";
type Item = Schedule | IdleList | Watch;

export const when = (at: number) => {
  const text = ago(at);
  return text === "ตอนนี้" ? text : `${text}ที่แล้ว`;
};

const deviceName = (id: string) => getMembers().flatMap((member) => member.devices).find((device) => device.id === id)?.name ?? "กุญแจที่ไม่รู้จัก";

// Why it is not running, or null. A Watch also stops when its signer can no longer read the path.
export function useProblem(item: Item) {
  const stopped = useStoppedReason(item, item.agent, "use");
  return stopped ?? ("path" in item ? watchProblem(item) : null);
}

export function describe(item: Item, problem: string | null): { label: string; icon: IconName; color: "red" | "green" | "orange" | "secondaryLabel" } {
  if (problem) return { label: "หยุด", icon: "key", color: "red" };
  if (item.paused) return { label: "พักไว้", icon: "time", color: "orange" };
  return { label: "ทำงานอยู่", icon: "done", color: "green" };
}

const cadenceLabel = (schedule: Schedule) => CADENCES.find((cadence) => cadence.value === schedule.cadence)?.label ?? schedule.cadence;

export function AutomationRow({ kind, item }: { kind: Kind; item: Item }) {
  const agent = useAgent(item.agent);
  const problem = useProblem(item);
  const state = describe(item, problem);
  const me = useCurrentMember();
  const base = `${agent?.name ?? item.agent} · เซ็นโดย ${memberName(item.signedBy)}`;
  const last = item.lastRunAt ? `รันล่าสุด ${when(item.lastRunAt)}` : "ยังไม่เคยรัน";
  const row =
    kind === "schedules"
      ? { icon: "schedule" as const, title: (item as Schedule).message, detail: `${cadenceLabel(item as Schedule)} · ${base} · ${last}`, href: `/automation/schedules/${item.id}` }
      : kind === "lists"
        ? { icon: "idle" as const, title: (item as IdleList).name, detail: `${(item as IdleList).items.filter((entry) => entry.status === "todo").length} ชิ้นที่รอ · ${base} · ${last}`, href: `/automation/idle/${item.id}` }
        : { icon: "watch" as const, title: (item as Watch).path, detail: `${(item as Watch).on === "new" ? "ไฟล์ใหม่" : "ไฟล์เปลี่ยน"} · ${base} · ${last}`, href: `/automation/watches/${item.id}` };
  return (
    <>
      <Row icon={row.icon} title={row.title} detail={row.detail} value={state.label} href={row.href} />
      {problem && <Row icon={state.icon} iconColor={state.color} title={problem} detail={canResign(item) ? undefined : "ต้องให้คนเซ็นหรือ Owner เซ็นใหม่จากกุญแจที่ยังใช้ได้"} />}
      {problem && canResign(item) && <Row icon="key" title="เซ็นใหม่ด้วยกุญแจของฉัน" detail={`งานจะทำในนามของ ${me.name} ต่อจากนี้`} onPress={() => signAgain(kind, item.id)} />}
    </>
  );
}

export async function signAgain(kind: Kind, id: string) {
  if (!(await authenticate("เซ็นงานนี้ใหม่ด้วยกุญแจของเครื่องนี้"))) return;
  inform(resign(kind, id).message);
}

const KIND_ICON: Record<RunKind, { icon: IconName; color: "green" | "red" | "orange" | "secondaryLabel" }> = {
  ran: { icon: "done", color: "green" },
  silent: { icon: "done", color: "secondaryLabel" },
  "caught-up": { icon: "restart", color: "green" },
  skipped: { icon: "stopped", color: "orange" },
  missed: { icon: "time", color: "orange" },
  refused: { icon: "failed", color: "red" },
  unfinished: { icon: "stopped", color: "red" },
  ignored: { icon: "info", color: "secondaryLabel" },
  merged: { icon: "branch", color: "secondaryLabel" },
  note: { icon: "info", color: "secondaryLabel" },
};

export function RunLogSection({ log }: { log: RunLog[] }) {
  return (
    <Section title="ประวัติรอบ" footer="รอบที่ข้าม ปฏิเสธ หรือไม่เสร็จถูกจดไว้ที่นี่ ไม่หายไปเงียบๆ">
      {log.length === 0 && <Row title="ยังไม่มีรอบ" />}
      {[...log].reverse().slice(0, 12).map((entry, index) => (
        <Row key={entry.at + String(index)} icon={KIND_ICON[entry.kind].icon} iconColor={KIND_ICON[entry.kind].color} title={entry.note} detail={when(entry.at)} href={entry.task ? `/tasks/${entry.task}` : undefined} />
      ))}
    </Section>
  );
}

// Who signed, on which key, and whether the key still works (ADR 0031).
export function SignedSection({ item, kind }: { item: Item; kind: Kind }) {
  const problem = useProblem(item);
  return (
    <Section title="ผู้เซ็น" footer="งานทำในนามของคนเซ็น และหยุดทันทีเมื่อกุญแจที่เซ็นถูกถอน Member ถูกลบ หรือไม่เหลือสิทธิ์ที่ Agent นี้">
      <Row icon="member" title={memberName(item.signedBy)} detail={`เซ็น ${when(item.signedAt)} ด้วย ${deviceName(item.signedDevice)}`} />
      {problem && <Row icon="key" iconColor="red" title={`หยุดอยู่: ${problem}`} />}
      {problem && canResign(item) && <Row icon="key" title="เซ็นใหม่ด้วยกุญแจของฉัน" onPress={() => signAgain(kind, item.id)} />}
      {problem && !canResign(item) && <Note icon="info">เซ็นใหม่ได้เฉพาะคนที่เซ็นหรือ Owner จากกุญแจที่ยังใช้ได้</Note>}
    </Section>
  );
}

// The thread of Tasks this origin opened (ADR 0061).
export function ThreadRow({ origin }: { origin: string }) {
  const count = useTasks().filter((task) => task.origin === origin).length;
  return (
    <Section>
      <Row icon="thread" title="เส้นร้อย Task" detail="ทุกรอบที่เคยรัน รวมรอบที่เงียบ" value={`${count}`} href={`/threads/${origin}`} />
    </Section>
  );
}
