import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { addDevice, thisDevice, useCurrentMember, type Device } from "../../../entities/member";
import { pushNotification } from "../../../entities/notification";
import { authenticate, Button, Card, Field, inform, Row, Screen, Section, Select, space, Text, useColors } from "../../../shared/ui";
import { newKey } from "../model/code";

const KINDS: { value: Device["kind"]; label: string }[] = [
  { value: "phone", label: "มือถือ" },
  { value: "tablet", label: "แท็บเล็ต" },
  { value: "web", label: "เว็บ" },
];

// A hash of the secret as a grid, standing in for the QR this device shows.
function QrStandIn({ seed }: { seed: string }) {
  const colors = useColors();
  const cells = Array.from({ length: 49 }, (_, i) => (parseInt(seed[(i * 7) % seed.length], 16) + i) % 3 !== 0);
  return (
    <View role="img" aria-label="QR ให้เครื่องใหม่สแกน" style={{ width: 7 * 12 + space.md, flexDirection: "row", flexWrap: "wrap", padding: space.sm, backgroundColor: colors.surface }}>
      {cells.map((on, i) => (
        <View key={i} style={{ width: 12, height: 12, backgroundColor: on ? colors.label : colors.surface }} />
      ))}
    </View>
  );
}

// Linking a second Controller of the same Member by QR (ADR 0013, 0031). This device shows the QR,
// carrying its Hub as `veeloe pair`'s does, so the new device never asks for one. The new device sends
// its key back through the Hub, bound to the QR's secret so the Hub cannot swap it, and this device's
// owner approves the request before signing. Only Linking by login compares a short code.
export function DeviceLinkPage() {
  const me = useCurrentMember();
  // ponytail: the secret is made here; a real link is veeloe://link?hub&to&id&secret&exp.
  const [secret] = useState(() => newKey());
  const link = `veeloe://link?hub=wss://hub.veeloe.dev&secret=${secret}`;
  const [asked, setAsked] = useState(false);
  // What the new device sends with its key: its own name, which this device may change.
  const [name, setName] = useState("iPad ของ " + me.name);
  const [kind, setKind] = useState<Device["kind"]>("tablet");

  async function approve() {
    const chosen = name.trim();
    if (!chosen) return inform("Link ไม่ได้", "ตั้งชื่อเครื่องใหม่ก่อน");
    if (me.devices.some((device) => !device.revoked && device.name === chosen)) return inform("Link ไม่ได้", `คุณมีเครื่องชื่อ ${chosen} แล้ว`);
    const signer = thisDevice(me);
    if (!signer) return;
    if (!(await authenticate(`Link เครื่อง ${chosen} เข้ากับ ${me.name} เครื่องนี้จะเซ็นรับรองกุญแจของมัน`))) return;
    addDevice(me.id, chosen, kind, signer.id);
    // Every other device of this Member hears about it (ADR 0031).
    pushNotification({ kind: "link", member: me.id, title: `มีเครื่อง ${chosen} ถูก Link จาก ${signer.name}`, href: "/devices" });
    router.replace("/devices");
  }

  return (
    <Screen title="Link เครื่องใหม่">
      <Section
        title="1. ให้เครื่องใหม่สแกน"
        footer="บนเครื่องใหม่ เปิดแอปแล้วเลือก ใช้กับเครื่องที่มีอยู่แล้ว แล้วสแกน QR นี้ หรือเปิดหรือวางลิงก์บนเครื่องที่ไม่มีกล้อง ลิงก์มี Hub ของเครื่องนี้ เครื่องใหม่จึงไม่ต้องกรอก Hub หมดอายุใน 10 นาที ใช้ได้ครั้งเดียว และ Link ใช้ได้กับเครื่องของ Member คนเดียวกันเท่านั้น (ADR 0013, 0031)"
      >
        <Card style={{ alignItems: "center" }}>
          <QrStandIn seed={secret} />
        </Card>
        <View style={{ padding: space.sm, gap: space.xs }}>
          <Text variant="footnote" tone="secondary">
            หรือแชร์ลิงก์นี้ไปที่เครื่องใหม่
          </Text>
          <Text selectable mono variant="footnote">
            {link}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
          <Button label="แชร์ลิงก์" onPress={() => inform("แชร์ลิงก์", "ของจริงเปิด share sheet ของระบบ")} />
          <Button label="จำลอง: เครื่องใหม่ขอ Link" disabled={asked} onPress={() => setAsked(true)} />
        </View>
      </Section>

      {asked && (
        <Section title="2. มีเครื่องขอ Link" footer="อนุมัติเฉพาะเมื่อเป็นเครื่องที่อยู่ตรงหน้าคุณ เครื่องนี้จะเซ็นรับรองกุญแจของมัน และเครื่องอื่นของคุณได้รับแจ้ง ถ้าไม่รู้จักชื่อนี้ ให้ยกเลิก">
          <Field label="ชื่อเครื่องใหม่" value={name} onChangeText={setName} />
          <View style={{ alignItems: "flex-start", padding: space.sm }}>
            <Select label="ชนิดเครื่อง" value={kind} options={KINDS} onChange={setKind} />
          </View>
          <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
            <Button label="ยกเลิก" onPress={() => router.back()} />
            <Button label="อนุมัติ" variant="primary" onPress={approve} />
          </View>
        </Section>
      )}

      <Section title="วิธีอื่น">
        <Row icon="member" title="Link ด้วย login" detail="เครื่องใหม่ login ด้วย email แล้วเครื่องนี้อนุมัติ" href="/devices/link-login" />
      </Section>
    </Screen>
  );
}
