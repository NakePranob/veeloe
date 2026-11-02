import { useAgents, useMachines } from "../../../entities/agent";
import { useCurrentMember, useMembers } from "../../../entities/member";
import { Note, Row, Screen, Section } from "../../../shared/ui";

// Everything that is not a conversation, grouped as a settings app groups it.
export function WorkspacePage() {
  const machines = useMachines();
  const agents = useAgents();
  const members = useMembers().filter((member) => !member.removed);
  const me = useCurrentMember();
  return (
    <Screen title="Workspace">
      <Note>Demo Workspace: Runtime กับ Hub เป็นตัวจำลองในแอป ไม่มีอะไรถูกส่งออกจากเครื่องนี้</Note>
      <Section title="บนเครื่อง">
        <Row icon="machine" title="Machine" value={`${machines.length}`} href="/machines" />
        <Row icon="agent" title="Agent" value={`${agents.length}`} href="/agents" />
        <Row icon="project" title="Project" href="/projects" />
        <Row icon="members" title="Team" href="/teams" />
        <Row icon="library" title="Library" href="/libraries" />
        <Row icon="blueprint" title="Blueprint" href="/blueprints" />
      </Section>
      <Section title="คน">
        <Row icon="members" title="Member" value={`${members.length}`} href="/members" />
        <Row icon="device" title="เครื่องของฉัน" detail={`ใช้งานในนาม ${me.name}`} href="/devices" />
      </Section>
      <Section title="ค่าใช้จ่ายและการแจ้งเตือน">
        <Row icon="usage" title="การใช้ token" href="/usage" />
        <Row icon="bell" title="การแจ้งเตือน" href="/notifications" />
        <Row icon="card" title="บัญชีและการเก็บเงิน" href="/account" />
      </Section>
      <Section title="ทดลอง" footer="ปิดเครื่อง จำลองการ restart เปลี่ยนคนที่ถือเครื่อง หรือให้ Budget ใกล้หมด เพื่อลองทุกกรณี">
        <Row icon="demo" title="ตัวควบคุม Demo" href="/demo" />
      </Section>
    </Screen>
  );
}
