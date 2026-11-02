import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Share } from "react-native";
import { useAgents, useMachine } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { getTasks } from "../../../entities/task";
import { Button, Card, Empty, inform, Row, Screen, Section, space, Text } from "../../../shared/ui";
import { canSeeMachine } from "../model/access";
import { formatLine, logLines } from "../model/logs";

interface Received {
  name: string;
  text: string;
  lines: number;
  at: number;
}

// Logs stay on the Machine with no content in them. The app asks for them with a signed request
// and gets the file back as an Attachment, shareable only when the owner presses the button (ADR 0052).
export function LogsPage() {
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachine(id);
  const agents = useAgents();
  const me = useCurrentMember();
  const [asking, setAsking] = useState(false);
  const [received, setReceived] = useState<Received>();

  if (!machine || !canSeeMachine(me, machine.id, agents)) {
    return (
      <Screen title="Log">
        <Empty icon="logs" title="ไม่พบ Machine นี้" />
      </Screen>
    );
  }

  function ask() {
    if (!machine) return;
    if (!machine.online) return inform("Machine ออฟไลน์", "ขอ log ได้เมื่อ Machine ออนไลน์ ระหว่างนี้ดูบนเครื่องด้วย veeloe logs");
    setAsking(true);
    // ponytail: the signed request, the Runtime's permission check and the Attachment transfer are one timer here.
    setTimeout(() => {
      const lines = logLines(machine, getTasks(), agents.filter((agent) => agent.machineId === machine.id).map((agent) => agent.id));
      setReceived({ name: `veeloe-${machine.name}-${new Date().toISOString().slice(0, 10)}.log`, text: lines.map(formatLine).join("\n"), lines: lines.length, at: Date.now() });
      setAsking(false);
    }, 900);
  }

  async function share() {
    if (!received) return;
    try {
      await Share.share({ message: received.text, title: received.name });
    } catch {
      // The browser has no share sheet, so the log goes to the clipboard instead.
      await navigator.clipboard?.writeText(received.text);
      inform("คัดลอกแล้ว", "เบราว์เซอร์นี้ไม่มีหน้าแชร์ จึงคัดลอก log ไปที่คลิปบอร์ด");
    }
  }

  return (
    <Screen title={`Log ${machine.name}`}>
      <Section title="ขอ log" footer="Machine เก็บ log ที่ <VEELOE_HOME>/runtime/logs หมุนไฟล์ทุกวันและเก็บ 14 วัน ดูบนเครื่องด้วย veeloe logs หรือ veeloe logs --follow">
        <Row icon="shield" title="Log ไม่มีเนื้อหา" detail="มีแค่รหัส Agent, Task และ Turn, ชนิดข้อความ, ชื่อ tool, ระยะเวลา, จำนวน token และ error ไม่มีข้อความแชต ผลของ tool หรือชื่อไฟล์ใน Workdir ถ้าต้องดูเนื้อหา เปิด Task นั้นคู่กัน" />
        <Row icon="member" title="ขอได้เฉพาะ Owner และคนที่มี Manage" detail="Runtime ตรวจสิทธิ์จากคำขอที่เซ็นก่อนส่ง" />
        <Card style={{ alignItems: "flex-start", marginTop: space.sm }}>
          <Button label={asking ? "กำลังขอจาก Machine..." : "ขอ log จาก Machine"} variant="primary" disabled={asking} onPress={ask} />
        </Card>
      </Section>
      {received && (
        <>
          <Section title="ไฟล์ที่ได้">
            <Row icon="file" title={received.name} detail={`${received.lines} บรรทัด · ${received.text.length.toLocaleString()} ตัวอักษร`} accessory={<Button label="แชร์" onPress={share} />} />
          </Section>
          <Card>
            {received.text ? (
              <Text variant="caption" mono selectable>
                {received.text}
              </Text>
            ) : (
              <Text tone="secondary">ยังไม่มีบรรทัดใน log</Text>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
