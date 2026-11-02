import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { removeMachine, useAgents, useMachine } from "../../../entities/agent";
import { setGrant, useCurrentMember, useMembers } from "../../../entities/member";
import { deleteTasksOf, getTasks } from "../../../entities/task";
import { stopTurn } from "../../../features/demo-runtime";
import { useRelease } from "../../../entities/release";
import { formatTokens, fromNow, useNow } from "../../../shared/lib";
import { authenticate, confirm, Empty, Icon, Meter, Note, Row, Screen, Section, space, Text } from "../../../shared/ui";
import { canSeeMachine } from "../model/access";
import { EgressSection } from "./EgressSection";
import { ProviderSection } from "./ProviderSection";

export function MachinePage() {
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachine(id);
  const agents = useAgents();
  const members = useMembers();
  const me = useCurrentMember();
  const release = useRelease(id);
  const now = useNow();

  if (!machine || !canSeeMachine(me, machine.id, agents)) {
    return (
      <Screen title="Machine">
        <Empty icon="machine" title="ไม่พบ Machine นี้" detail="Machine อาจถูกเลิกผูกแล้ว หรือคุณไม่ได้ดูแล Agent ตัวไหนบนเครื่องนี้" />
      </Screen>
    );
  }

  const onMachine = agents.filter((agent) => agent.machineId === machine.id);
  const used = onMachine.reduce((sum, agent) => sum + agent.usedToday, 0);
  const budget = onMachine.reduce((sum, agent) => sum + agent.budget, 0);
  const share = budget ? used / budget : 0;

  async function unpair() {
    if (!machine) return;
    const gone = onMachine.map((agent) => agent.name);
    const yes = await confirm({
      title: `เลิกผูก ${machine.name}?`,
      message: `${gone.length ? `Agent ${gone.join(", ")} และ Task ของมันจะหายจากแอป ` : ""}Machine เลิกเชื่อกุญแจของ Controller ทุกตัว ส่วนโฟลเดอร์ Agent กับ Workdir ยังอยู่บนดิสก์ของเครื่องจนเจ้าของเครื่องลบเอง (ADR 0032, 0035)`,
      action: "เลิกผูก",
      destructive: true,
    });
    if (!yes || !(await authenticate(`เลิกผูก ${machine.name} ออกจาก Workspace`))) return;
    for (const agent of onMachine) {
      for (const task of getTasks().filter((candidate) => candidate.agent === agent.id)) stopTurn(task.id);
      deleteTasksOf(agent.id);
      members.forEach((member) => setGrant(member.id, agent.id, null));
    }
    removeMachine(machine.id);
    router.replace("/machines");
  }

  return (
    <Screen title={machine.name}>
      <Section title="สถานะ" footer="Runtime ส่งสถานะนี้ให้ Owner และคนที่มี Manage ทุกครั้งที่ต่อเข้ามาและเมื่อมีการเปลี่ยน (ADR 0052)">
        <Row icon="machine" iconColor={machine.online ? "green" : "tertiaryLabel"} title="สถานะ" value={machine.online ? "ออนไลน์" : "ออฟไลน์"} detail={machine.online ? undefined : "ดูประวัติ Task ได้เฉพาะส่วนที่แอป cache ไว้ และข้อความที่ส่งจะรออยู่ในเครื่องนี้ (ADR 0005, 0021)"} />
        <Row icon="info" title="Runtime" value={`${machine.version} · ${machine.os}`} />
        <Row icon="blueprint" title="feature ที่เครื่องนี้มี" detail={machine.features.join(", ")} />
        <Row icon="list" title="พื้นที่ดิสก์ที่เหลือ" value={`${machine.diskFreeGb} GB`} />
        {machine.lastError && <Row icon="info" iconColor="orange" title="error ล่าสุด" detail={machine.lastError} />}
        <View style={{ gap: space.sm, padding: space.sm }}>
          <Text>Budget วันนี้ของ Agent บนเครื่องนี้</Text>
          <Meter value={share} label="Budget วันนี้" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {share >= 0.8 && <Icon name="info" size="sm" color="orange" />}
            <Text variant="footnote" tone="secondary">
              {formatTokens(used)} จาก {formatTokens(budget)} token ({Math.round(share * 100)}%)
            </Text>
          </View>
        </View>
      </Section>

      <Section title="Agent บนเครื่องนี้">
        {onMachine.length === 0 && <Row title="ยังไม่มี Agent" detail={me.owner ? "สร้าง Agent ได้เมื่อมี Provider" : undefined} />}
        {onMachine.map((agent) => (
          <Row key={agent.id} icon="agent" title={agent.name} detail={agent.description} href={`/agents/${agent.id}`} />
        ))}
      </Section>

      <ProviderSection machine={machine} owner={me.owner} />
      <EgressSection machine={machine} owner={me.owner} />

      <Section title="ดูแลเครื่อง">
        {machine.features.includes("logs") && <Row icon="logs" title="Log" detail="ไม่มีเนื้อหา ขอจาก Machine ได้" href={`/machines/${machine.id}/logs`} />}
        <Row icon="download" title="อัปเดต Runtime" href={`/machines/${machine.id}/updates`} />
        {me.owner && (
          <Row
            icon="shield"
            iconColor={release ? "orange" : undefined}
            title="ปล่อย Machine"
            // While released it keeps working here, so the page says so with the time left (ADR 0035).
            detail={release ? `ปล่อยไว้แล้ว หมดอายุใน ${fromNow(release.expiresAt, now)} ยังทำงานใน Workspace นี้` : "ย้ายไป Workspace อื่นพร้อม Agent"}
            href={`/machines/${machine.id}/release`}
          />
        )}
      </Section>

      {me.owner && (
        <Section title="เลิกผูก" footer="เลิกผูกในแอปเอาเครื่องกับ Agent บนเครื่องออกจาก Workspace นี้ ประวัติและไฟล์ของ Agent ไม่ตามไป และยังอยู่บนดิสก์ของเครื่อง บนเครื่องเองเลิกผูกได้เสมอด้วย veeloe unpair ถ้าจะเอาเครื่องไปไว้ที่ Workspace อื่นพร้อม Agent ให้ใช้ ปล่อย Machine แทน (ADR 0035)">
          <Row icon="trash" title="เลิกผูก Machine นี้" destructive onPress={unpair} />
        </Section>
      )}
      {!me.owner && <Note>เฉพาะ Owner เพิ่มหรือลบ Provider, แก้ Egress, ปล่อยหรือเลิกผูก Machine</Note>}
    </Screen>
  );
}
