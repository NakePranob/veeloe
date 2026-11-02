import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useAgent } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { Card, Empty, Icon, Meter, Note, Row, Screen, Section, space, Text } from "../../../shared/ui";

// ponytail: MEMORY.md as the app last saw it. The Runtime counts characters itself, with no tokenizer (ADR 0036).
const CAP = 4_000;

// MEMORY.md is pinned into every Task and written by the Agent, so a Member reads it here but
// cannot edit it (ADR 0036).
export function MemoryPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  const me = useCurrentMember();
  if (!agent || !can(me, agent.id, "use")) {
    return (
      <Screen title="Memory">
        <Empty icon="file" title="ไม่พบ Agent นี้" />
      </Screen>
    );
  }
  const used = agent.memory.length;
  return (
    <Screen title={`Memory ของ ${agent.name}`}>
      <Section title="MEMORY.md">
        <View style={{ gap: space.sm, padding: space.sm }}>
          <Meter value={used / CAP} label="ขนาด Memory" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {used > CAP && <Icon name="info" size="sm" color="orange" />}
            <Text variant="footnote" tone="secondary">
              {used.toLocaleString()} จาก {CAP.toLocaleString()} ตัวอักษร{used > CAP ? " · เกินเพดาน Runtime ใส่ให้ Agent แค่ส่วนต้นแล้วบอกให้ย่อ" : ""}
            </Text>
          </View>
        </View>
        <Card style={{ margin: space.xs }}>
          {agent.memory.trim() ? (
            <Text mono selectable variant="subheadline">
              {agent.memory}
            </Text>
          ) : (
            <Text tone="secondary">ยังว่างอยู่ Agent จดเองเมื่อมีเรื่องที่ทุก Task ต้องรู้</Text>
          )}
        </Card>
        {!agent.machine.online && <Row icon="info" iconColor="orange" title="Machine ออฟไลน์" detail="นี่คือสำเนาที่แอป cache ไว้ล่าสุด (ADR 0005)" />}
      </Section>

      <Section title="Memory ทำงานอย่างไร">
        <Row icon="thread" title="ตรึงไว้ทั้ง Task" detail="Runtime ใส่ไฟล์นี้เข้า prompt ตอนเริ่มทุก Task แล้วตรึงไว้ สิ่งที่ Agent จดกลาง Task จะเห็นผลใน Task ถัดไป เพื่อไม่ให้ prompt cache เสีย" />
        <Row icon="member" title="Agent เป็นคนเขียน" detail="Agent แก้ไฟล์นี้ด้วย tool ไฟล์ปกติ ในแอปนี้อ่านได้อย่างเดียว ไม่มีใครแก้จากที่นี่ได้ (ADR 0036)" />
        <Row icon="file" title="เพดาน 4,000 ตัวอักษร" detail="นับเป็นตัวอักษรเผื่อภาษาไทย ตั้งต่อ Agent ไม่ได้ Agent จึงต้องเลือกจดเฉพาะสิ่งที่ทุก Task ต้องรู้" />
      </Section>
      <Note icon="info" iconColor="orange">
        Memory โดนวางยาได้ ถ้าหน้าเว็บหรือคนในแชตหลอกให้ Agent จดคำสั่งไว้ คำสั่งนั้นจะติดไปทุก Task รวมถึงของ Member คนอื่น และ Allowlist กันไม่ได้เพราะการแก้ไฟล์ไม่ผ่าน Allowlist อ่านหน้านี้เป็นระยะ และดูตอนที่ Agent แก้ไฟล์นี้ใน Task
      </Note>
    </Screen>
  );
}
