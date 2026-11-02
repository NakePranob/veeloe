import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgents, useMachines, type Machine } from "../../../entities/agent";
import { INVITE_TTL, statusOf, updateInvitation, useInvitations, type Invitation, type InviteLevel, type InviteStatus } from "../../../entities/invitation";
import { GRANT_LABEL, useCurrentMember } from "../../../entities/member";
import { useFrozen } from "../../../entities/account";
import { setMachineOnline } from "../../../features/demo-runtime";
import { canInvite, codesOf, compareCodes, createInvite, manageableAgents, neededMachines, openLink } from "../../../features/membership";
import { fromNow, useNow } from "../../../shared/lib";
import { Empty, Field, inform, Label, Note, Row, Screen, Section, Select, Text, ToggleRow, space } from "../../../shared/ui";

const STATUS: Record<InviteStatus, string> = { open: "รอใช้", expired: "หมดอายุ", used: "ใช้แล้ว", refused: "ไม่ผ่าน" };
const LEVELS = [
  { value: "none", label: "ไม่แนบ" },
  ...(["use", "approve", "manage"] as const).map((value) => ({ value, label: GRANT_LABEL[value] })),
] as const;

const code = (words: string[]) => words.join(" · ");

function InvitationCard({ invitation, swapped, machines }: { invitation: Invitation; swapped: boolean; machines: Machine[] }) {
  const now = useNow(5_000);
  // Read the clock itself, so a simulated expiry shows at once rather than at the next tick.
  const status = statusOf(invitation);
  const { invitee, issuer } = codesOf(invitation);
  const agents = useAgents();
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;
  const run = (refusal: string | null) => refusal && inform("ทำไม่ได้", refusal);
  const offline = neededMachines(invitation).map((machine) => machines.find((candidate) => candidate.id === machine.id) ?? machine).filter((machine) => !machine.online);
  const waiting = invitation.stage === "signed";
  return (
    <Section title={`${invitation.name} · ${waiting ? "รอ Runtime" : STATUS[status]}`}>
      <Row
        icon="link"
        mono
        title={`https://veeloe.app/i/${invitation.token}`}
        detail={
          invitation.stage === "link" || invitation.stage === "opened"
            ? status === "expired"
              ? "หมดอายุแล้ว"
              : `ใช้ได้ครั้งเดียว หมดอายุอีก ${fromNow(invitation.expiresAt, now)}`
            : "ใช้ครั้งเดียวไปแล้ว"
        }
      />
      {Object.keys(invitation.grants).length > 0 && (
        <Row icon="key" title="Grant ที่แนบ" detail={Object.entries(invitation.grants).map(([agent, level]) => `${nameOf(agent)}: ${GRANT_LABEL[level]}`).join(", ")} />
      )}
      {invitation.stage === "opened" && (
        <>
          <Row icon="device" title="รหัสบนเครื่องของคนที่ถูกเชิญ" detail={code(invitee)} />
          <Row icon="shield" title="รหัสบนเครื่องนี้ (จากกุญแจที่ Hub ส่งมา)" detail={code(issuer)} />
          <Row icon="info" title="เทียบกับคนที่ถูกเชิญทางอื่น" detail="เช่นโทรคุยกัน อย่าเทียบผ่านช่องทางเดียวกับที่ส่งลิงก์" />
          <Row icon="done" iconColor="green" title="รหัสตรงกัน เซ็นรับรอง" onPress={async () => run(await compareCodes(invitation.id, true))} />
          <Row icon="failed" iconColor="red" title="รหัสไม่ตรง ปฏิเสธ" onPress={async () => run(await compareCodes(invitation.id, false))} />
        </>
      )}
      {waiting && (
        <>
          <Row
            icon="time"
            iconColor="orange"
            title="เซ็นรับรองแล้ว รอ Runtime"
            detail="ใบรับรองที่ Manager เซ็นต้องผ่าน Runtime ของ Agent ที่แนบ Grant ซึ่งตรวจ Manage ก่อนแจ้ง Hub ถ้าเครื่องปิดอยู่ คนใหม่ยังเข้าไม่ได้"
          />
          {offline.map((machine) => (
            <Row key={machine.id} icon="machine" title={`${machine.name} ปิดอยู่`} detail="จำลอง: เปิดเครื่องนี้ แล้ว Runtime ตรวจ Manage และรับคนเข้า" onPress={() => setMachineOnline(machine.id, true)} />
          ))}
        </>
      )}
      {invitation.stage === "joined" && (
        <>
          <Row icon="done" iconColor="green" title="เข้าเป็น Member แล้ว" href={`/members/${invitation.joinedAs}`} />
          {Object.keys(invitation.pending).length > 0 && (
            <Row icon="time" iconColor="orange" title="Grant ที่รอเครื่องออนไลน์" detail={Object.keys(invitation.pending).map(nameOf).join(", ") + " มีผลเมื่อ Machine ของ Agent นั้นกลับมา"} />
          )}
        </>
      )}
      {invitation.stage === "refused" && <Row icon="failed" iconColor="red" title="ไม่ได้เข้า Workspace" detail={invitation.refusal} />}
      <Row icon="play" title="จำลอง: คนที่ถูกเชิญเปิดลิงก์" detail={swapped ? "เปิดโดยที่ Hub สลับกุญแจ รหัสสองฝั่งจะไม่ตรง" : undefined} onPress={() => run(openLink(invitation.id, swapped))} />
      {(invitation.stage === "link" || invitation.stage === "opened") && status !== "expired" && (
        <Row icon="time" title="จำลอง: ผ่านไป 24 ชั่วโมง" detail="ทำให้ลิงก์หมดอายุ" onPress={() => updateInvitation(invitation.id, { expiresAt: Date.now() - 1 })} />
      )}
    </Section>
  );
}

// Invitation: a link that brings one person into this Workspace, with Grants attached (ADR 0031, 0059).
export function InvitePage() {
  const me = useCurrentMember();
  useAgents();
  const machines = useMachines();
  const invitations = useInvitations().filter((invitation) => invitation.issuer === me.id);
  const frozen = useFrozen(me.id);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState<Record<string, InviteLevel | "none">>({});
  const [swapped, setSwapped] = useState(false);
  const agents = manageableAgents(me);

  if (!canInvite(me)) {
    return (
      <Screen title="เชิญ Member">
        <Empty icon="lock" title="เชิญไม่ได้" detail="Invitation ออกโดย Owner หรือคนที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัว ขอให้คนที่มีสิทธิ์เชิญแทน" />
      </Screen>
    );
  }

  const create = async () => {
    if (frozen) return inform("ทำไม่ได้", "Workspace กำลังรอลบ ทุกคำสั่งถูกปฏิเสธยกเว้นการยกเลิกการลบ");
    const grants = Object.fromEntries(Object.entries(levels).filter((entry): entry is [string, InviteLevel] => entry[1] !== "none"));
    const refusal = await createInvite(me, name, grants);
    if (refusal) return inform("เชิญไม่ได้", refusal);
    setName("");
    setLevels({});
  };

  return (
    <Screen title="เชิญ Member" right={{ label: "สร้างลิงก์", onPress: create, disabled: !name.trim() }}>
      <Section footer="ชื่อห้ามซ้ำกับคนอื่นใน Workspace คนที่รับเชิญตั้งชื่อตัวเองเป็นคนอื่นไม่ได้ เพราะคุณเป็นคนรู้ว่ากำลังเชิญใครและเป็นคนเทียบรหัสกับเขา">
        <Field label="ชื่อของคนที่เชิญ" value={name} onChangeText={setName} placeholder="เช่น Beam" />
      </Section>
      <Section
        title="Grant ที่แนบไปกับลิงก์"
        footer={me.owner ? "Owner แนบ Grant ได้ทุก Agent" : "แนบได้เฉพาะ Agent ที่คุณมี Manage Agent อื่นไม่แสดงตรงนี้"}
      >
        {agents.length === 0 && <Row icon="info" title="ยังไม่มี Agent" detail="ลิงก์นี้จะพาคนเข้า Workspace โดยยังไม่มี Grant" />}
        {agents.map((agent) => (
          <Row
            key={agent.id}
            icon="agent"
            title={agent.name}
            detail={agent.machine.name}
            accessory={<Select label={`Grant ที่ ${agent.name}`} value={levels[agent.id] ?? "none"} options={LEVELS} onChange={(value) => setLevels((current) => ({ ...current, [agent.id]: value }))} />}
          />
        ))}
      </Section>
      <Note icon="shield">
        ลิงก์ใช้ได้ครั้งเดียว หมดอายุใน 24 ชั่วโมง และคุณต้องเทียบรหัสสั้นกับคนที่ถูกเชิญก่อนเซ็นรับรอง {me.owner ? "ใบรับรองของ Owner ส่งตรงถึง Hub" : "ใบรับรองของ Manager ส่งผ่าน Runtime ของ Agent ที่แนบ Grant ซึ่งตรวจ Manage ให้"}
      </Note>
      <Section title="ทดลองฝั่งคนที่ถูกเชิญ" footer="Hub ที่โดนเจาะสลับกุญแจได้ รหัสที่เทียบกันจึงเป็นทางเดียวที่จับได้ (ADR 0006)">
        <ToggleRow icon="warning" title="จำลอง: Hub สลับกุญแจระหว่างทาง" detail="มีผลกับลิงก์ที่เปิดหลังจากนี้" value={swapped} onChange={setSwapped} />
      </Section>
      {invitations.length === 0 ? (
        <View style={{ paddingHorizontal: space.sm }}>
          <Text variant="footnote" tone="secondary">
            ยังไม่มี Invitation ที่คุณออก สร้างลิงก์แล้วจะแสดงตรงนี้พร้อมสถานะ
          </Text>
        </View>
      ) : (
        invitations.map((invitation) => <InvitationCard key={invitation.id} invitation={invitation} swapped={swapped} machines={machines} />)
      )}
      <Label icon="members">
        <Link href="/members">กลับไปรายชื่อ Member</Link> · ลิงก์หมดอายุใน {INVITE_TTL / 3_600_000} ชั่วโมง
      </Label>
    </Screen>
  );
}
