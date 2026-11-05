import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { addDevice, thisDevice, useCurrentMember, type Device } from "../../../entities/member";
import { pushNotification } from "../../../entities/notification";
import { authenticate, Button, Card, Field, inform, Row, Screen, Section, Select, space, useColors } from "../../../shared/ui";
import { newKey } from "../model/code";

const KINDS: { value: Device["kind"]; label: string }[] = [
  { value: "phone", label: "มือถือ" },
  { value: "tablet", label: "แท็บเล็ต" },
  { value: "web", label: "เว็บ" },
];

// A hash of the key as a grid, standing in for the QR the new device shows.
function KeyStandIn({ keyText }: { keyText: string }) {
  const colors = useColors();
  const cells = Array.from({ length: 49 }, (_, i) => (parseInt(keyText[(i * 7) % keyText.length], 16) + i) % 3 !== 0);
  return (
    <View role="img" aria-label="QR ที่เครื่องใหม่แสดง" style={{ width: 7 * 12 + space.md, flexDirection: "row", flexWrap: "wrap", padding: space.sm, backgroundColor: colors.surface }}>
      {cells.map((on, i) => (
        <View key={i} style={{ width: 12, height: 12, backgroundColor: on ? colors.label : colors.surface }} />
      ))}
    </View>
  );
}

// Linking a second Controller of the same Member by QR (ADR 0013, 0031). The new key goes from the
// new device's screen into this device's camera, so no Hub stands between them to swap it, and there
// is no short code to compare: this device names the new one and signs. Only Linking by login compares one.
export function DeviceLinkPage() {
  const me = useCurrentMember();
  const [name, setName] = useState("iPad ของ " + me.name);
  const [kind, setKind] = useState<Device["kind"]>("tablet");
  // ponytail: the new device's key is made here; a real one is made on that device and read by scanning.
  const [key] = useState(() => newKey());
  const [scanned, setScanned] = useState(false);

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
      <Section title="1. เครื่องใหม่ (จำลอง)" footer="ของจริง: เปิดแอปบนเครื่องใหม่แล้วเลือกเข้าด้วย Link เครื่องใหม่แสดง QR ที่มีกุญแจสาธารณะของมัน และ Link ใช้ได้กับเครื่องของ Member คนเดียวกันเท่านั้น (ADR 0013, 0031)">
        <Field label="ชื่อเครื่องใหม่" value={name} onChangeText={setName} />
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Select label="ชนิดเครื่อง" value={kind} options={KINDS} onChange={setKind} />
        </View>
        <Card style={{ alignItems: "center", marginTop: space.sm }}>
          <KeyStandIn keyText={key} />
          <View style={{ alignSelf: "stretch", alignItems: "center", paddingTop: space.sm }}>
            <Button label="จำลอง: สแกนแล้ว" disabled={scanned} onPress={() => setScanned(true)} />
          </View>
        </Card>
      </Section>

      {scanned && (
        <Section title="2. อนุมัติ" footer="อนุมัติเฉพาะเครื่องที่อยู่ตรงหน้าคุณ เครื่องนี้จะเซ็นรับรองกุญแจของมัน และเครื่องอื่นของคุณได้รับแจ้ง">
          <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
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
