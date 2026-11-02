import { router, useLocalSearchParams } from "expo-router";
import { useAgents, useMachines } from "../../../entities/agent";
import { deleteLibrary, pageName, setAccess, useLibraries, writePage, writerOf, type Access } from "../../../entities/library";
import { useCurrentMember } from "../../../entities/member";
import { authenticate, confirm, Empty, inform, Note, Row, Screen, Section, Select } from "../../../shared/ui";
import { libraryVisible } from "./access";
import { Ask } from "./Ask";
import { Pages } from "./Pages";

type Level = Access | "none";
const LEVELS = [
  { value: "none", label: "ไม่เข้าถึง" },
  { value: "read", label: "อ่านอย่างเดียว" },
  { value: "write", label: "เขียนได้" },
] as const;

export function LibraryPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useCurrentMember();
  const agents = useAgents();
  const machines = useMachines();
  const library = useLibraries().find((item) => item.id === id);

  if (!library || !libraryVisible(me, library)) {
    return (
      <Screen title="Library">
        <Empty icon="library" title="ไม่พบ Library นี้" detail="อาจถูกลบแล้ว หรือไม่มี Agent ที่คุณใช้ได้อ่าน Library นี้" />
      </Screen>
    );
  }

  const name = (agentId: string | undefined) => agents.find((agent) => agent.id === agentId)?.name ?? "ไม่มี";
  const machine = machines.find((item) => item.id === library.machineId);
  const writer = writerOf(library);

  const change = async (agentId: string, level: Level) => {
    const before = library.access[agentId];
    if (level === "none") return setAccess(library.id, agentId, null);
    if (!before && !(await confirm({ title: `ให้ ${name(agentId)} เข้าถึง ${library.name}?`, message: `ทุกคนที่มี Use ที่ ${name(agentId)} จะขอดูเนื้อหาของ Library นี้ผ่าน Agent ได้ รวมถึงคนในแชตของ Channel ถ้า Agent มี`, action: "ให้เข้าถึง" }))) return;
    setAccess(library.id, agentId, level);
    if (level === "write" && writer && writer !== agentId) inform("ผู้เขียนเปลี่ยนแล้ว", `Library มีผู้เขียนได้ตัวเดียว ${name(writer)} เปลี่ยนเป็นอ่านอย่างเดียว`);
  };

  const remove = async () => {
    if (!(await confirm({ title: `ลบ ${library.name}?`, message: "ลบหน้าทั้งหมดของคลังนี้ออกจาก Machine", action: "ลบ", destructive: true }))) return;
    if (!(await authenticate(`ลบ Library ${library.name}`))) return;
    deleteLibrary(library.id);
    router.back();
  };

  // ponytail: both stand in for what the Agent does inside its sandbox; the same writePage refuses.
  const agentWrites = () => {
    if (!writer) return inform("ยังไม่มีผู้เขียน", "ตั้ง Agent ที่เขียนได้ก่อน");
    const slug = `note-${library.pages.length}`;
    writePage(library.id, writer, `${slug}.md`, `# บันทึกใหม่\n\n${name(writer)} เพิ่มหน้านี้ กลับไปที่ [[index]]\n`);
    const index = library.pages.find((page) => page.path === "index.md");
    if (index) writePage(library.id, writer, "index.md", `${index.content.trimEnd()}\n- [[${pageName(slug)}]]\n`);
  };
  const readerWrites = () => {
    const reader = Object.entries(library.access).find(([, level]) => level === "read")?.[0];
    if (!reader) return inform("ไม่มี Agent ที่อ่านอย่างเดียว", "ตั้ง Agent เป็นอ่านอย่างเดียวก่อนลอง");
    const result = writePage(library.id, reader, "index.md", "# แก้ทับ\n");
    inform(result.ok ? "เขียนได้" : `${name(reader)} เขียนไม่ได้`, result.ok ? undefined : result.reason);
  };

  return (
    <Screen title={library.name}>
      <Section title="ที่อยู่" footer="Library อยู่บน Machine เดียว Agent บนเครื่องอื่นใช้ไม่ได้ ถ้าต้องใช้ข้ามเครื่อง ให้ Agent ที่เขียน push ขึ้น git แล้วอีกเครื่อง clone ไป">
        <Row icon="machine" title="Machine" value={machine?.name} />
        <Row icon="agent" title="Agent ที่เขียน" value={name(writer)} />
        <Row icon="agent" title="Agent ที่อ่านได้" value={Object.entries(library.access).filter(([, level]) => level === "read").map(([agent]) => name(agent)).join(", ") || "ไม่มี"} />
      </Section>

      {me.owner ? (
        <>
          <Section title="Agent ที่เข้าถึง" footer="ให้ Agent อ่าน Library ได้ เท่ากับให้ทุกคนที่มี Use ที่ Agent นั้นอ่านได้ด้วย Agent ที่เป็นผู้เขียนมีตัวเดียว sandbox เป็นคนบังคับ">
            {agents.map((agent) =>
              agent.machineId === library.machineId ? (
                <Row key={agent.id} title={agent.name} accessory={<Select label={`สิทธิ์ของ ${agent.name}`} value={(library.access[agent.id] ?? "none") as Level} options={LEVELS} onChange={(level) => change(agent.id, level)} />} />
              ) : (
                <Row key={agent.id} title={agent.name} detail={`อยู่บน ${agent.machine.name} ใช้ Library บน ${machine?.name} ไม่ได้`} value="ใช้ไม่ได้" />
              ),
            )}
          </Section>
          <Pages library={library} />
          <Note icon="info">แอปให้ Owner ดูหน้าเอง ส่วนหน้าดู Library พร้อมกราฟสำหรับคนอื่นเป็นฟีเจอร์ทีหลังและยังไม่ได้ตัดสินว่าใครดูได้ ตอนนี้คนที่มี Use ถามผ่าน Agent แทน</Note>
          <Note icon="info">ถ้าเจ้าของเครื่องแก้หน้าใน Obsidian เอง จะเป็นผู้เขียนคนที่สองและอาจทับกับ Agent ที่กำลังเขียน Obsidian สร้าง .obsidian/ ในคลัง ซึ่ง Agent ข้ามไป</Note>
        </>
      ) : (
        <Note icon="info">Owner เป็นคนกำหนดว่า Agent ตัวไหนเข้าถึง Library นี้ คุณถามเนื้อหาผ่าน Agent ที่คุณมี Use ได้</Note>
      )}

      <Ask library={library} me={me} />

      {me.owner && (
        <Section title="จำลอง" footer="สิ่งที่ในระบบจริงเกิดใน sandbox ของ Agent">
          <Row icon="play" title="Agent ที่เขียนเพิ่มหน้า" detail={`${name(writer)} เขียนหน้าใหม่และใส่ลิงก์ในสารบัญ`} onPress={agentWrites} />
          <Row icon="lock" title="Agent ที่อ่านอย่างเดียวพยายามเขียน" detail="sandbox ต้องปฏิเสธ" onPress={readerWrites} />
        </Section>
      )}
      {me.owner && (
        <Section>
          <Row icon="trash" destructive title="ลบ Library" onPress={remove} />
        </Section>
      )}
    </Screen>
  );
}
