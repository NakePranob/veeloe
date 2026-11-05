import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { memberName, revokeDevice, thisDevice, updateMember, useCurrentMember, type Device, type Member } from "../../../entities/member";
import { ago } from "../../../shared/lib";
import { authenticate, Button, confirm, Field, inform, Note, Row, Screen, Section, space, ToggleRow } from "../../../shared/ui";

const since = (at: number) => (ago(at) === "ตอนนี้" ? "ตอนนี้" : `${ago(at)}ที่แล้ว`);
const KIND_ICON = { phone: "device", tablet: "device", web: "network" } as const;

// This Member's Controllers, who linked each and when, and the way to cut one off (ADR 0031, 0053).
export function DevicesPage() {
  const me = useCurrentMember();
  const live = me.devices.filter((device) => !device.revoked);
  const revoked = me.devices.filter((device) => device.revoked);
  const here = thisDevice(me);
  return (
    <Screen title="เครื่องของฉัน" right={{ label: "Link เครื่องใหม่", onPress: () => router.push("/devices/link") }}>
      <Section title={`เครื่องของ ${me.name}`} footer="ชื่อเครื่องตั้งไว้ให้ดูในหน้านี้และในแจ้งเตือนตอน Link เจ้าของกับ Owner เห็นชื่อเครื่อง คนอื่นไม่เห็น ทุกครั้งที่มีการ Link เครื่องอื่นของคุณได้รับแจ้ง (ADR 0053)">
        {live.map((device) => (
          <DeviceRow key={device.id} device={device} member={me} here={device.id === here?.id} />
        ))}
      </Section>
      {revoked.length > 0 && (
        <Section title="ถูกถอนแล้ว">
          {revoked.map((device) => (
            <Row key={device.id} icon={KIND_ICON[device.kind]} title={device.name} detail="ไม่ใช้งานแล้ว ต้อง Link ใหม่ถ้าจะใช้อีก" />
          ))}
        </Section>
      )}
      <Section title="Link เครื่องใหม่" footer="Link ใช้ได้กับเครื่องของคุณเองเท่านั้น คนอื่นเข้า Workspace ผ่าน Invitation">
        <Row icon="add" title="Link ด้วย QR" detail="สแกน QR บนเครื่องใหม่" href="/devices/link" />
        <Row icon="member" title="Link ด้วย login" href="/devices/link-login" />
      </Section>
      {live.length < 2 && <Note icon="info" iconColor="orange">คุณมีเครื่องเดียว ถ้าเครื่องหาย หรือเปลี่ยนการตั้ง biometric จนกุญแจใช้ไม่ได้ จะไม่มีเครื่องไหนเซ็นคำสั่งแทนได้ ต้องทำ Pairing ใหม่ที่หน้า Machine ทุกเครื่อง Link เครื่องที่สองไว้ก่อน (ADR 0012, 0013)</Note>}
    </Screen>
  );
}

function DeviceRow({ device, member, here }: { device: Device; member: Member; here: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(device.name);
  // The certificates this key signed; the rest of them stop working unless kept (ADR 0031).
  const signed = member.devices.filter((other) => other.linkedBy === device.id && !other.revoked);
  const [dropped, setDropped] = useState<string[]>([]);
  const keep = signed.filter((other) => !dropped.includes(other.id)).map((other) => other.id);
  const linker = device.linkedBy ? member.devices.find((other) => other.id === device.linkedBy)?.name ?? memberName(member.id) : undefined;

  function rename() {
    const chosen = name.trim();
    if (!chosen) return inform("เปลี่ยนชื่อไม่ได้", "ชื่อเครื่องว่างไม่ได้");
    if (member.devices.some((other) => other.id !== device.id && !other.revoked && other.name === chosen)) return inform("เปลี่ยนชื่อไม่ได้", `คุณมีเครื่องชื่อ ${chosen} แล้ว`);
    updateMember(member.id, { devices: member.devices.map((other) => (other.id === device.id ? { ...other, name: chosen } : other)) });
  }

  async function revoke() {
    const kept = signed.filter((other) => keep.includes(other.id));
    const survivors = member.devices.filter((other) => !other.revoked && other.id !== device.id && (other.linkedBy !== device.id || kept.some((k) => k.id === other.id)));
    if (survivors.length === 0) {
      return inform("ถอนเครื่องนี้ไม่ได้", `ถ้าถอน ${device.name} จะไม่เหลือเครื่องที่ใช้ได้เลย ไม่มีเครื่องไหนเซ็นคำสั่งถอนหรือ Link ต่อได้อีก v0.1 ยังไม่มี email ให้กู้ ถ้าเครื่องนี้หายจริง ให้รัน veeloe unpair ที่ Machine แล้วทำ Pairing ใหม่ (ADR 0013, 0031) หรือ Link เครื่องอื่นก่อนแล้วค่อยถอน`);
    }
    const dropped = signed.filter((other) => !keep.includes(other.id)).map((other) => other.name);
    const yes = await confirm({
      title: `ถอนกุญแจ ${device.name}?`,
      message: `${here ? "นี่คือเครื่องที่ถืออยู่ แอปจะใช้เครื่องถัดไปแทน " : ""}เครื่องนี้ตัดสายจาก Hub ทันที และ Schedule, Idle Work, Watch, Channel กับ Connector ที่เซ็นจากเครื่องนี้หยุด รอเซ็นใหม่จากเครื่องอื่น${dropped.length ? ` เครื่อง ${dropped.join(", ")} ที่เครื่องนี้เคยรับรองจะหลุดด้วย` : ""}${kept.length ? ` ใบรับรองที่เก็บไว้: ${kept.map((other) => other.name).join(", ")}` : ""}`,
      action: "ถอนกุญแจ",
      destructive: true,
    });
    if (!yes || !(await authenticate(`ถอนกุญแจของ ${device.name}`))) return;
    revokeDevice(member.id, device.id, keep);
  }

  return (
    <View>
      <Row
        icon={KIND_ICON[device.kind]}
        title={device.name}
        detail={`${linker ? `Link โดย ${linker}` : "เครื่องแรก"} · ${since(device.linkedAt)}`}
        value={here ? "เครื่องนี้" : undefined}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={{ paddingLeft: space.xl }}>
          <Field label="ชื่อเครื่อง" value={name} onChangeText={setName} />
          <View style={{ alignItems: "flex-start", padding: space.sm }}>
            <Button label="บันทึกชื่อ" disabled={name.trim() === device.name} onPress={rename} />
          </View>
          {signed.length > 0 && (
            <>
              <Row title="เครื่องที่เครื่องนี้เคยรับรอง" detail="ติ๊กเครื่องที่ยังไว้ใจ ใบรับรองของเครื่องที่ไม่ติ๊กจะใช้ไม่ได้อีก ไม่ว่าลงวันที่เมื่อไหร่ ถ้าไม่ได้เลือกเครื่องไหนไว้ เครื่องนั้นหลุดและต้อง Link ใหม่" />
              {signed.map((other) => (
                <ToggleRow key={other.id} title={`เก็บ ${other.name} ไว้`} value={keep.includes(other.id)} onChange={(on) => setDropped(on ? dropped.filter((id) => id !== other.id) : [...dropped, other.id])} />
              ))}
            </>
          )}
          <Row icon="trash" title="ถอนกุญแจเครื่องนี้" destructive onPress={revoke} />
        </View>
      )}
    </View>
  );
}
