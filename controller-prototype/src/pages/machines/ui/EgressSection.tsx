import { useState } from "react";
import { View } from "react-native";
import { updateMachine, useAgents, type Machine } from "../../../entities/agent";
import { authenticate, Button, Field, inform, Row, Section, space } from "../../../shared/ui";

const DOMAIN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/;

// The domains every Agent on this Machine may reach. One list for the whole Machine until
// Egress is split per Agent in v0.3 (ADR 0008, 0029).
export function EgressSection({ machine, owner }: { machine: Machine; owner: boolean }) {
  const names = useAgents().filter((agent) => agent.machineId === machine.id).map((agent) => agent.name);
  const [draft, setDraft] = useState("");
  const who = names.length ? `Agent ทุกตัวบน ${machine.name} (${names.join(", ")})` : `Agent ทุกตัวบน ${machine.name}`;

  async function change(next: string[], reason: string) {
    if (!machine.online) return inform("Machine ออฟไลน์", `${machine.name} ต้องออนไลน์ก่อน Runtime ตรวจลายเซ็นของคำสั่งนี้`);
    if (!(await authenticate(`${reason} มีผลกับ ${who}`))) return;
    updateMachine(machine.id, { egress: next });
  }

  function add() {
    const domain = draft.trim().toLowerCase();
    if (!DOMAIN.test(domain)) return inform("โดเมนไม่ถูกต้อง", "ใส่ชื่อโดเมนอย่างเดียว เช่น github.com หรือ *.npmjs.org ไม่ต้องมี https:// หรือ path");
    if (machine.egress.includes(domain)) return inform("มีโดเมนนี้แล้ว", domain);
    change([...machine.egress, domain], `เพิ่ม ${domain} ใน Egress`).then(() => setDraft(""));
  }

  return (
    <Section title="Egress" footer={`โดเมนเหล่านี้เปิดให้ ${who} ออกไปได้ ไม่ใช่เฉพาะ Agent ตัวใดตัวหนึ่ง นอกรายการนี้ sandbox ปิดเน็ต ข้อมูลยังส่งออกไปโดเมนในรายการได้ จึงเพิ่มเฉพาะที่ไว้ใจ (ADR 0008)`}>
      {machine.egress.length === 0 && <Row title="ไม่มีโดเมนที่อนุญาต" detail="Agent ออกเน็ตไม่ได้เลย" />}
      {machine.egress.map((domain) => (
        <Row key={domain} icon="network" title={domain} mono accessory={owner ? <Button label="ลบ" onPress={() => change(machine.egress.filter((item) => item !== domain), `ลบ ${domain} ออกจาก Egress`)} /> : undefined} />
      ))}
      {owner && (
        <View>
          <Field label="เพิ่มโดเมน" value={draft} onChangeText={setDraft} placeholder="เช่น pypi.org" mono />
          <View style={{ alignItems: "flex-start", padding: space.sm }}>
            <Button label="เพิ่มโดเมน" disabled={!draft.trim()} onPress={add} />
          </View>
        </View>
      )}
    </Section>
  );
}
