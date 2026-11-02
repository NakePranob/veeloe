import { View } from "react-native";
import { newDay, getAgents, updateAgent, useAgents, useMachines } from "../../../entities/agent";
import { GRANT_LABEL, setCurrentMember, useCurrentMemberId, useMembers } from "../../../entities/member";
import { budgetChanged, restartMachine, setMachineOnline } from "../../../features/demo-runtime";
import { Button, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

// ponytail: the Demo Workspace has no real Machine, clock or second phone, so these controls
// stand in for them. They change the same state the rest of the app reads.
export function DemoPage() {
  const members = useMembers().filter((member) => !member.removed);
  const holder = useCurrentMemberId();
  const machines = useMachines();
  const agents = useAgents();

  function fill(id: string, share: number) {
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) return;
    const usedToday = Math.floor(agent.budget * share);
    // The difference counts as Task work, so today's split still adds up to today's total.
    updateAgent(id, { usedToday, usageBySource: { ...agent.usageBySource, Task: Math.max(0, (agent.usageBySource.Task ?? 0) + usedToday - agent.usedToday) } });
    budgetChanged(id);
  }

  function turnTheDay() {
    newDay();
    getAgents().forEach((agent) => budgetChanged(agent.id));
    inform("ขึ้นวันใหม่แล้ว", "ยอดใช้ของวันนี้เริ่มจาก 0 และ Task ที่หยุดเพราะ Budget หมดได้รับแจ้งว่าไปต่อได้");
  }

  return (
    <Screen title="ตัวควบคุม Demo">
      <Note>ทุกอย่างในหน้านี้ใช้ได้เฉพาะ Demo Workspace ของจริงมี Machine, นาฬิกาและมือถือคนอื่นเอง</Note>
      <Section title="ใครถือเครื่องนี้" footer="เปลี่ยนแล้วทุกหน้ามองในนามคนนั้น ลองดูว่า Use, Approve และ Manage เห็นและทำอะไรได้ต่างกันแค่ไหน">
        {members.map((member) => (
          <Row
            key={member.id}
            icon="member"
            title={member.name}
            detail={member.owner ? "Owner: Manage ทุก Agent" : Object.entries(member.grants).map(([agent, grant]) => `${agent} ${GRANT_LABEL[grant]}`).join(", ") || "ยังไม่มี Grant"}
            value={member.id === holder ? "ถืออยู่" : undefined}
            onPress={() => setCurrentMember(member.id)}
          />
        ))}
      </Section>

      <Section title="Machine" footer="ปิดเครื่อง: ข้อความที่ส่งไปรอในเครื่องนี้ (outbox) แล้วออกเองตอนเปิด restart: Turn ที่ทำอยู่จบเหมือนโดน Stop และไม่ทำต่อเอง (ADR 0033)">
        {machines.map((machine) => (
          <View key={machine.id}>
            <ToggleRow icon="machine" title={`${machine.name} เปิดอยู่`} value={machine.online} onChange={(on) => setMachineOnline(machine.id, on)} />
            <Row icon="restart" title={`restart ${machine.name} กลาง Turn`} onPress={() => (machine.online ? restartMachine(machine.id) : inform("เครื่องปิดอยู่", "เปิดเครื่องก่อน"))} />
          </View>
        ))}
      </Section>

      <Section title="Budget" footer="79% ต้องมี Turn อีกสองสามรอบถึงจะข้าม 80% และมี push 100% หยุด Turn ที่กำลังทำและงานใหม่ไม่เริ่ม (ADR 0043)">
        {agents.map((agent) => (
          <Row
            key={agent.id}
            icon="agent"
            title={agent.name}
            detail={`ใช้วันนี้ ${Math.round((agent.usedToday / agent.budget) * 100)}%`}
            accessory={
              <>
                <Button label="79%" onPress={() => fill(agent.id, 0.79)} />
                <Button label="100%" onPress={() => fill(agent.id, 1)} />
              </>
            }
          />
        ))}
      </Section>

      <Section title="เวลา" footer="วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine ที่นี่กดแทน">
        <Row icon="schedule" title="ขึ้นวันใหม่" detail="ล้างยอดใช้ของทุก Agent" onPress={turnTheDay} />
      </Section>

      <Section title="เริ่มใช้ Workspace จริง">
        <Row icon="play" title="ดูขั้นตอนแรกของ Workspace" detail="ไม่มีรหัสผ่าน ล็อกหน้าจอ Owner และ Pairing" href="/welcome" />
      </Section>
    </Screen>
  );
}
