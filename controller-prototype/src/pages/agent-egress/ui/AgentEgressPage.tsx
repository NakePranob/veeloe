import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgent, useAgents } from "../../../entities/agent";
import { usePolicy } from "../../../entities/agent-policy";
import { can, useCurrentMember } from "../../../entities/member";
import { addEgress, copyEgress, removeEgress, setInternet } from "../../../features/agent-settings";
import { Empty, Field, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

// Where one Agent may reach on the network, kept per Agent with no list shared by the Machine (ADR 0029).
export function AgentEgressPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  const others = useAgents().filter((candidate) => candidate.id !== id && candidate.machineId === agent?.machineId);
  const me = useCurrentMember();
  const policy = usePolicy(id);
  const [text, setText] = useState("");

  if (!agent) return <Screen title="Egress"><Empty icon="agent" title="ไม่พบ Agent" /></Screen>;
  const manage = can(me, agent.id, "manage");
  const run = async (promise: Promise<string | null>) => {
    const why = await promise;
    if (why) inform("ทำไม่ได้", why);
    return why;
  };
  const add = async () => {
    if (!(await run(addEgress(me, agent.id, text)))) setText("");
  };

  return (
    <Screen title={`Egress ของ ${agent.name}`} right={manage ? { label: "เพิ่ม", onPress: add, disabled: !text.trim() || policy.internet } : undefined}>
      <Section title="ทั้งเน็ตสาธารณะ" footer="สำหรับงาน research ที่บอกล่วงหน้าไม่ได้ว่าจะไปโดเมนไหน หน้าเว็บไหนก็ฝังคำสั่งได้ คนนอกจึงสั่ง Agent ได้ทางอ้อมแบบเดียวกับ Channel ระหว่างที่เปิด จึงอ่านไฟล์ได้แค่ใน Workdir ของ Agent เองกับ Library ที่ได้สิทธิ์ (ADR 0029, 0037)">
        <ToggleRow icon="network" title="ออกได้ทั้งเน็ตสาธารณะ" detail="ไม่รวมที่อยู่ภายใน" value={policy.internet} onChange={manage ? (value) => run(setInternet(me, agent.id, value)) : () => inform("ทำไม่ได้", `ต้องมี Manage ที่ ${agent.name}`)} />
      </Section>
      {policy.internet && (
        <>
          <Note icon="warning" iconColor="orange">
            ไม่รวม loopback, เครือข่ายส่วนตัว และ link-local ซึ่งรวม 169.254.169.254 ที่ cloud ใช้แจก credential ให้เครื่อง proxy ตรวจที่อยู่ที่โดเมนชี้ไปก่อนต่อทุกครั้ง
          </Note>
          <Note icon="lock" iconColor="orange">
            {agent.name} อ่านไฟล์ได้แค่ Workdir ของตัวเองกับ Library ที่ได้สิทธิ์ จนกว่าจะปิดตัวเลือกนี้
          </Note>
        </>
      )}
      <Section title="โดเมนที่ออกไปได้" footer={policy.internet ? "รายการนี้ไม่ถูกใช้ระหว่างที่เปิดทั้งเน็ต แต่ยังเก็บไว้" : "เริ่มจากสำเนารายชื่อของ Machine ตอนที่ Egress แยกต่อ Agent ไม่มีรายชื่อกลางที่ Agent ทุกตัวใช้ร่วมกัน คำขอไป Provider ผ่าน proxy ของ Runtime จึงไม่ต้องอยู่ในนี้"}>
        {policy.egress.length === 0 && <Row icon="info" title="ยังไม่มีโดเมน" detail="Agent เปิดเว็บหรือเรียก API ผ่านเครื่องไม่ได้" />}
        {policy.egress.map((entry) => (
          <Row key={entry} icon="network" mono title={entry} onPress={manage ? async () => { run(removeEgress(me, agent.id, entry)); } : undefined} value={manage ? "เอาออก" : undefined} />
        ))}
      </Section>
      {manage ? (
        <Section footer="ใส่ชื่อโดเมน เช่น api.github.com หรือ *.example.com localhost, ที่อยู่ในเครือข่ายส่วนตัว และ 169.254.169.254 ใส่ไม่ได้">
          <Field label="เพิ่มโดเมน" value={text} onChangeText={setText} placeholder="เช่น registry.npmjs.org" mono />
        </Section>
      ) : (
        <Note icon="lock">แก้ Egress ได้เฉพาะคนที่มี Manage ที่ {agent.name}</Note>
      )}
      {manage && others.length > 0 && (
        <Section title="คัดลอกจาก Agent อื่น" footer="เป็นทางลัดในแอป คัดลอกรายการมาเพิ่ม ไม่ได้ผูกกัน แก้ที่ไหนอีกที่ไม่เปลี่ยนตาม คัดลอกได้จาก Agent บนเครื่องเดียวกัน">
          {others.map((other) => (
            <Row key={other.id} icon="agent" title={other.name} onPress={() => run(copyEgress(me, agent.id, other.id))} value="คัดลอก" />
          ))}
        </Section>
      )}
    </Screen>
  );
}
