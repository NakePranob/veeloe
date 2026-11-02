import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { FROZEN_MESSAGE, isFrozen, pairingRefusal } from "../../../entities/account";
import { addMachine, useMachines, type Machine } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { authenticate, Button, Card, Empty, Field, inform, Note, Row, Screen, Section, Select, space, Text, useColors } from "../../../shared/ui";
import { checkCode, currentCode, issueCode, REFUSAL, spendCode, useOffers } from "../model/pairing";

const OS: { value: Machine["os"]; label: string }[] = [
  { value: "macOS", label: "macOS" },
  { value: "Linux", label: "Linux" },
  { value: "WSL2", label: "Windows (WSL2)" },
];

// ponytail: the real install script's address is not decided; this is where a Runtime release would sit (ADR 0009, 0025).
const INSTALL = "curl -fsSL https://github.com/NakePranob/veeloe/releases/latest/download/install.sh | sh";

const SIZE = 11;

// Stands in for the QR on the Machine's screen: a pattern worked out from the code, so a new code looks new.
function QrStandIn({ code }: { code: string }) {
  const colors = useColors();
  let seed = [...code].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // The three corner squares are drawn on every QR, so the stand-in has them too.
  const corner = (x: number, y: number) => (x < 3 && y < 3) || (x > SIZE - 4 && y < 3) || (x < 3 && y > SIZE - 4);
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) => corner(i % SIZE, Math.floor(i / SIZE)) || next() > 0.5);
  return (
    <View role="img" aria-label="QR ที่ Machine แสดง" style={{ width: SIZE * 12, flexDirection: "row", flexWrap: "wrap", padding: space.sm, backgroundColor: colors.surface }}>
      {cells.map((on, i) => (
        <View key={i} style={{ width: 12, height: 12, backgroundColor: on ? colors.label : colors.surface }} />
      ))}
    </View>
  );
}

// Pairing (ADR 0006, 0035): the Machine shows a QR and a one-time code on its own screen, the
// Controller reads it, and the Owner authenticates. The Hub never carries the keys.
export function PairPage() {
  const me = useCurrentMember();
  const machines = useMachines();
  const [os, setOs] = useState<Machine["os"]>("macOS");
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  useOffers();
  const code = currentCode();

  if (!me.owner) {
    return (
      <Screen title="Pairing">
        <Empty icon="lock" title="เฉพาะ Owner ทำ Pairing ได้" detail="Pairing เพิ่ม Machine ที่ต้องจ่ายเงิน ให้ขอ Owner ของ Workspace" />
      </Screen>
    );
  }

  async function pair(given: string) {
    if (isFrozen(me.id)) return inform("Pairing ไม่สำเร็จ", FROZEN_MESSAGE);
    // The Hub counts quota here and says only that it is exceeded, with no price or link (ADR 0001, 0024).
    const overQuota = pairingRefusal(machines.length);
    if (overQuota) return inform("Pairing ไม่สำเร็จ", overQuota);
    const result = checkCode(given);
    if (result !== "ok") return inform("Pairing ไม่สำเร็จ", REFUSAL[result]);
    const chosen = name.trim();
    if (!chosen) return inform("Pairing ไม่สำเร็จ", "Machine ยังไม่รายงานชื่อ");
    if (machines.some((machine) => machine.name === chosen)) return inform("Pairing ไม่สำเร็จ", `มี Machine ชื่อ ${chosen} ใน Workspace แล้ว`);
    if (!(await authenticate(`Pairing กับ ${chosen} (${os}) Machine นี้จะอ่านคำสั่งที่ Controller ของคุณเซ็น`))) return;
    // Spent only now: a cancelled authentication leaves the code usable.
    spendCode(given);
    const machine = addMachine(chosen, os);
    router.replace(`/machines/${machine.id}`);
  }

  return (
    <Screen title="Pairing">
      <Section title="1. ติดตั้ง Runtime บน Machine" footer={os === "WSL2" ? "Windows ยังไม่มีรุ่น native: ติดตั้งรุ่น Linux ใน WSL2 Agent จะทำงานฝั่ง Linux และแตะ tool ของ Windows ไม่ได้ (ADR 0008)" : "รันบนเครื่องที่จะให้ Agent ทำงาน แล้วรัน veeloe pair ให้เครื่องแสดงรหัส"}>
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Select label="ระบบปฏิบัติการของ Machine" value={os} options={OS} onChange={setOs} />
        </View>
        <Row title={INSTALL} mono />
        <Row title="veeloe pair" mono />
      </Section>

      <Section title="2. จำลอง: หน้าจอของ Machine" footer="ของจริงคือจอของ Machine เอง ไม่ผ่าน Hub เพื่อให้ Hub สลับกุญแจระหว่างทางไม่ได้">
        <Field label="ชื่อ Machine ที่เครื่องรายงาน" value={name} onChangeText={setName} placeholder="เช่น studio-2" />
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Button
            label={code ? "จำลอง: ขอรหัสใหม่" : "จำลอง: รัน veeloe pair"}
            onPress={() => (name.trim() ? issueCode() : inform("ใส่ชื่อ Machine ก่อน", "Runtime รายงานชื่อเครื่องของมันเอง ช่องนี้คือชื่อที่เครื่องจะรายงาน"))}
          />
        </View>
        {code && (
          <Card style={{ alignItems: "center", gap: space.md, marginTop: space.sm }}>
            <QrStandIn code={code} />
            <Text variant="largeTitle" mono selectable>
              {code}
            </Text>
            <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
              รหัสใช้ได้ครั้งเดียว ขอรหัสใหม่แล้วรหัสเก่าใช้ไม่ได้
            </Text>
          </Card>
        )}
      </Section>

      <Section title="3. ที่ Controller" footer="สแกน QR ด้วยกล้อง หรือพิมพ์รหัสที่เห็นบนจอถ้าสแกนไม่ได้ จากนั้นยืนยันตัวตนเพื่อเซ็น Pairing (ADR 0012)">
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Button label="จำลอง: สแกน QR แล้ว" variant="primary" disabled={!code} onPress={() => code && pair(code)} />
        </View>
        <Field label="หรือพิมพ์รหัส" value={typed} onChangeText={setTyped} placeholder="XXXX-XXXX" mono />
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Button label="ใช้รหัสนี้" disabled={!typed.trim()} onPress={() => pair(typed)} />
        </View>
      </Section>
      <Note>Pairing แลกกุญแจกันตรงๆ ระหว่าง Controller กับ Machine Hub ไม่เคยเห็นกุญแจ และ Machine หนึ่งอยู่ได้ Workspace เดียว (ADR 0006, 0035)</Note>
    </Screen>
  );
}
