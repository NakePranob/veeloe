import { useAgents } from "../../../entities/agent";
import { BLUEPRINTS, useInstalls } from "../../../entities/blueprint";
import { Note, Row, Screen, Section } from "../../../shared/ui";

export function BlueprintsPage() {
  const installs = useInstalls();
  const agents = useAgents();
  return (
    <Screen title="Blueprint">
      <Note>
        Blueprint คือแม่แบบของ Agent ที่คนอื่นทำมา ติดตั้งแล้วได้ Agent ปกติหนึ่งตัวที่ใช้ Provider และ Budget ของคุณ คนทำไม่เห็นข้อมูลของคุณ marketplace จริงมาหลัง v0.3 ตอนนี้เป็นแค่สารบัญ และไม่มีอะไรรันเป็น plugin ในตัว Runtime (ADR 0049)
      </Note>
      <Section footer="ทุกรายการแสดงสิ่งที่ขอก่อนติดตั้ง ตัวที่ขอ Egress หลายโดเมนหรือ Allowlist กว้างควรอ่านให้ละเอียด">
        {BLUEPRINTS.map((blueprint) => {
          const installed = installs.filter((install) => install.blueprint === blueprint.id);
          return (
            <Row
              key={blueprint.id}
              icon="blueprint"
              title={blueprint.name}
              detail={`${blueprint.summary}\nโดย ${blueprint.author}${installed.length ? ` · ติดตั้งแล้ว: ${installed.map((install) => agents.find((agent) => agent.id === install.agent)?.name ?? "ลบแล้ว").join(", ")}` : ""}`}
              href={`/blueprints/${blueprint.id}`}
            />
          );
        })}
      </Section>
    </Screen>
  );
}
