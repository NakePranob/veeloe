import { useAgents, useMachines } from "../../../entities/agent";
import { useLibraries, writerOf } from "../../../entities/library";
import { useCurrentMember } from "../../../entities/member";
import { Empty, Row, Screen, Section } from "../../../shared/ui";
import { libraryVisible } from "./access";

export function LibrariesPage() {
  const me = useCurrentMember();
  const agents = useAgents();
  const machines = useMachines();
  const libraries = useLibraries().filter((library) => libraryVisible(me, library));
  return (
    <Screen title="Library">
      <Section footer="Library เป็นคลังความรู้ Markdown บน Machine เดียว แยกจาก Workdir ให้หลาย Agent อ่านได้ และมี Agent เขียนได้ตัวเดียว">
        {libraries.length === 0 && <Empty icon="library" title="ยังไม่มี Library" detail={me.owner ? "Owner สร้าง Library แล้วกำหนดว่า Agent ตัวไหนอ่านหรือเขียน" : "ยังไม่มี Library ที่ Agent ของคุณอ่านได้"} />}
        {libraries.map((library) => {
          const writer = writerOf(library);
          const readers = Object.keys(library.access).length;
          return (
            <Row
              key={library.id}
              icon="library"
              title={library.name}
              detail={`${machines.find((machine) => machine.id === library.machineId)?.name ?? "?"} · ${library.pages.length} หน้า · เขียน: ${agents.find((agent) => agent.id === writer)?.name ?? "ยังไม่มี"}`}
              value={`${readers} Agent`}
              href={`/libraries/${library.id}`}
            />
          );
        })}
        {me.owner && <Row icon="add" title="สร้าง Library" detail="เฉพาะ Owner" href="/libraries/new" />}
      </Section>
    </Screen>
  );
}
