import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { useAutomation } from "../../../entities/automation";
import { useChannels } from "../../../entities/channel";
import { useConnectors } from "../../../entities/connector";
import { useInvitations } from "../../../entities/invitation";
import { GRANT_LABEL, memberName, useCurrentMember, useMember, type Grant } from "../../../entities/member";
import { dropWorkOf } from "../../../features/demo-runtime";
import { changeGrant, manageableAgents, removalRefusal, removeMemberNow, renameMember } from "../../../features/membership";
import { ago, useNow } from "../../../shared/lib";
import { confirm, Empty, Field, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";
import { ownedBy } from "../model/owned";

const OPTIONS = [{ value: "none", label: "ไม่มี" }, ...(["use", "approve", "manage"] as const).map((value) => ({ value, label: GRANT_LABEL[value] }))] as const;

export function MemberPage() {
  const { member: id } = useLocalSearchParams<{ member: string }>();
  const me = useCurrentMember();
  const target = useMember(id);
  const agents = useAgents();
  const invitations = useInvitations();
  useAutomation();
  useChannels();
  useConnectors();
  const now = useNow();
  const [name, setName] = useState<string>();
  const [resign, setResign] = useState<Record<string, boolean>>({});

  if (!target || target.removed) return (
    <Screen title="Member">
      <Empty icon="member" title="ไม่พบ Member คนนี้" detail="อาจถูกเอาออกจาก Workspace แล้ว ประวัติยังแสดงเขาเป็นอดีต Member" />
    </Screen>
  );

  const editing = name ?? target.name;
  const canRename = me.id === target.id || me.owner;
  const manageable = manageableAgents(me);
  const pending = invitations.find((invitation) => invitation.joinedAs === target.id)?.pending ?? {};
  const owned = ownedBy(target.id);
  const refusal = removalRefusal(me, target);
  const seesDevices = me.owner || me.id === target.id;

  const save = () => {
    const why = renameMember(me, target.id, editing);
    if (why) inform("เปลี่ยนชื่อไม่ได้", why);
    else setName(undefined);
  };

  const remove = async () => {
    if (!(await confirm({ title: `ลบ ${target.name} ออกจาก Workspace`, message: "ถอนกุญแจทุกเครื่องและ Grant ทั้งหมด Turn ที่ทำในนามเขาถูก Stop และงานในคิวถูกทิ้ง", action: "ลบ", destructive: true }))) return;
    const why = await removeMemberNow(me, target.id);
    if (why) return inform("ลบไม่ได้", why);
    // Their Turns stop and their queue is dropped (ADR 0031).
    dropWorkOf(target.id, me.id);
    for (const item of owned) (resign[item.id] ? item.resign : item.drop)();
    router.back();
  };

  return (
    <Screen title={target.name} right={canRename ? { label: "บันทึกชื่อ", onPress: save, disabled: editing.trim() === target.name } : undefined}>
      <Section footer={canRename ? "ชื่อห้ามซ้ำกับคนอื่นใน Workspace เปลี่ยนแล้วประวัติทั้งหมดแสดงชื่อใหม่" : "เปลี่ยนชื่อได้เฉพาะของตัวเอง หรือโดย Owner"}>
        {canRename ? <Field label="ชื่อ" value={editing} onChangeText={setName} /> : <Row icon="member" title={target.name} />}
        <Row icon="shield" title="บทบาท" value={target.owner ? "Owner" : "Member"} />
        <Row icon="members" title="เชิญโดย" value={target.invitedBy ? memberName(target.invitedBy) : "ตั้ง Workspace"} />
        <Row icon="time" title="ใช้งานล่าสุด" value={ago(target.lastActiveAt, now)} />
        {seesDevices && <Row icon="device" title="เครื่อง" detail={target.devices.map((device) => device.name + (device.revoked ? " (ถอนแล้ว)" : "")).join(", ")} value={`${target.devices.filter((device) => !device.revoked).length}`} />}
      </Section>

      {target.owner ? (
        <Note icon="shield">Owner มี Manage ที่ทุก Agent อยู่แล้ว ปลดจาก Owner ที่หน้ารายชื่อ Member ถ้าจะกำหนด Grant เอง</Note>
      ) : (
        <Section title="Grant ต่อ Agent" footer={me.owner ? "การแจกหรือเปลี่ยน Grant ต้องยืนยันตัวตนและเซ็นโดย Owner หรือคนที่มี Manage ที่ Agent นั้น" : manageable.length ? "แสดงเฉพาะ Agent ที่คุณมี Manage" : "คุณไม่มี Manage ที่ Agent ตัวไหน จึงแก้ Grant ของใครไม่ได้"}>
          {manageable.map((agent) => (
            <Row
              key={agent.id}
              icon="agent"
              title={agent.name}
              detail={pending[agent.id] ? `${GRANT_LABEL[pending[agent.id]]} รอ ${agent.machine.name} ออนไลน์` : agent.machine.name}
              accessory={
                <Select
                  label={`Grant ที่ ${agent.name}`}
                  value={target.grants[agent.id] ?? "none"}
                  options={OPTIONS}
                  onChange={async (value) => {
                    const why = await changeGrant(me, target.id, agent.id, value === "none" ? null : (value as Grant));
                    if (why) inform("เปลี่ยน Grant ไม่ได้", why);
                  }}
                />
              }
            />
          ))}
          {manageable.length === 0 && agents.length > 0 && <Row icon="lock" title="ไม่มี Agent ที่คุณมี Manage" />}
        </Section>
      )}

      {me.owner && (
        <>
          <Section
            title="ที่ Member คนนี้ตั้งไว้"
            footer="สิ่งเหล่านี้เซ็นด้วยกุญแจของเขา จึงหยุดทันทีที่ลบ เลือกเซ็นใหม่เป็นชื่อคุณให้ทำงานต่อ ที่ไม่เลือก supervisor ลบ credential ทิ้ง ไม่เก็บสิทธิ์เข้าบัญชีของคนที่ไม่ได้อยู่แล้ว"
          >
            {owned.length === 0 && <Row icon="info" title="ไม่มี Schedule, Idle Work, Watch, Channel หรือ Connector" />}
            {owned.map((item) => (
              <ToggleRow key={item.id} icon={item.kind === "Channel" ? "channel" : item.kind === "Connector" ? "connector" : item.kind === "Idle Work" ? "idle" : item.kind === "Watch" ? "watch" : "schedule"} title={`${item.kind}: ${item.title}`} detail={`${item.detail ?? ""} · เซ็นใหม่เป็นชื่อฉัน`} value={!!resign[item.id]} onChange={(value) => setResign((current) => ({ ...current, [item.id]: value }))} />
            ))}
          </Section>
          <Section footer={refusal ?? "ถอนกุญแจทุกเครื่องและ Grant ทั้งหมด Turn ที่ทำในนามเขาถูก Stop งานในคิวถูกทิ้ง และ Task ที่เขาสั่งแสดงเป็นอดีต Member"}>
            <Row icon="trash" destructive title="ลบ Member ออกจาก Workspace" onPress={refusal ? () => inform("ลบไม่ได้", refusal) : remove} />
          </Section>
        </>
      )}
    </Screen>
  );
}
