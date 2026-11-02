import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { authenticate, Button, inform, Note, Row, Screen, Section, space, Text, ToggleRow, type IconName } from "../../../shared/ui";

interface Step {
  title: string;
  rows: { icon: IconName; title: string; detail: string }[];
  footer?: string;
}

const STEPS: Step[] = [
  {
    title: "ไม่มีรหัสผ่าน",
    rows: [
      { icon: "key", title: "กุญแจคือตัวตนของคุณ", detail: "แอปสร้างกุญแจบนเครื่องนี้ ส่วนที่เป็นความลับไม่ออกจากเครื่อง Hub รู้แค่กุญแจสาธารณะ" },
      { icon: "lock", title: "ไม่มีรหัสให้ลืม หลุด หรือรีเซ็ต", detail: "ทุกครั้งที่ต่อ Hub แอปเซ็นข้อความสุ่มที่ Hub ส่งมา เพื่อพิสูจน์ว่าเป็นเครื่องนี้" },
      { icon: "shield", title: "คำสั่งทุกอย่างเซ็นด้วยกุญแจ", detail: "Runtime ตรวจลายเซ็นก่อนทำ Hub ที่โดนเจาะจึงปลอมเป็นแอปไม่ได้ (ADR 0006, 0013)" },
    ],
  },
  {
    title: "ล็อกหน้าจอก่อน",
    rows: [
      { icon: "lock", title: "ต้องมี Face ID ลายนิ้วมือ หรือรหัสเครื่อง", detail: "ไม่อย่างนั้นใครหยิบมือถือที่ปลดล็อกอยู่ไปก็สั่ง Agent รันคำสั่งบนเครื่องของคุณได้ เครื่องที่ไม่ได้ตั้งการล็อกหน้าจอสร้างกุญแจไม่ได้" },
      { icon: "approval", title: "ยืนยันตัวตนซ้ำก่อนเรื่องสำคัญ", detail: "อนุมัติ Approval, Link เครื่อง, แจก Grant, เลื่อน Owner, ติดตั้ง Skill, แก้ Allowlist หรือ Egress, Pairing, ปล่อย Machine และถอนกุญแจ (ADR 0012)" },
    ],
  },
  {
    title: "คุณคือ Owner",
    rows: [
      { icon: "member", title: "Controller ตัวแรกสร้าง Workspace", detail: "และได้เป็น Owner: ทำ Pairing, สร้าง Agent, เพิ่มหรือลบ Member และแจก Grant ได้ มี Manage ที่ Agent ทุกตัว" },
      { icon: "members", title: "คนอื่นเข้ามาด้วย Invitation", detail: "ลิงก์ใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง ทั้งสองฝั่งเทียบรหัสสั้นก่อนเซ็นรับรอง ใน v0.1 มี Member คนเดียวคือคุณ (ADR 0031, 0048)" },
    ],
  },
  {
    title: "ผูก Machine ด้วย Pairing",
    rows: [
      { icon: "machine", title: "ติดตั้ง Runtime บนเครื่องที่ Agent จะทำงาน", detail: "macOS, Linux หรือ Windows ผ่าน WSL2 เครื่องแสดง QR กับรหัสใช้ครั้งเดียวบนจอของมันเอง" },
      { icon: "key", title: "สแกนแล้วยืนยันตัวตน", detail: "กุญแจแลกกันตรงๆ ระหว่างแอปกับเครื่อง ไม่ผ่าน Hub หลัง Pairing เพิ่ม Provider แล้วสร้าง Agent ได้ (ADR 0006, 0042)" },
    ],
    footer: "กดข้ามไปลองทำ Pairing ได้เลยในหน้าถัดไปของแอป",
  },
  {
    title: "Link เครื่องที่สอง",
    rows: [
      { icon: "device", title: "ถ้าเครื่องนี้เป็นเครื่องเดียวที่คุณมี", detail: "ทำเครื่องหาย หรือเปลี่ยนการตั้ง biometric จนกุญแจใช้ไม่ได้ จะไม่มีเครื่องไหนเซ็นแทน v0.1 ยังไม่มี email ให้กู้" },
      { icon: "trash", title: "ต้องเริ่มใหม่ทั้งหมด", detail: "รัน veeloe unpair ที่ Machine ทุกเครื่องแล้วทำ Pairing ใหม่ Agent กับประวัติ Task ไม่ตามมา (ADR 0013, 0031)" },
    ],
  },
];

// A walk through a real Workspace's first run. Nothing here creates a key or a Workspace; it ends back
// in the Demo Workspace (ADR 0012, 0013, 0024).
export function WelcomePage() {
  const [step, setStep] = useState(0);
  const [locked, setLocked] = useState(true);
  const [fingerprint, setFingerprint] = useState<string>();
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  async function next() {
    if (step === 1 && !fingerprint) {
      if (!locked) return inform("สร้างกุญแจไม่ได้", "เครื่องนี้ยังไม่ได้ตั้งการล็อกหน้าจอ ตั้ง Face ID ลายนิ้วมือ หรือรหัสเครื่องใน Settings ของเครื่องก่อน");
      if (!(await authenticate("สร้างกุญแจของ Controller นี้ และเก็บใน Keychain หรือ Keystore ของเครื่อง"))) return;
      // ponytail: a real key is Ed25519 made by @noble and kept in the OS keystore (ADR 0012).
      setFingerprint(Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join(""));
    }
    if (last) return router.replace("/");
    setStep(step + 1);
  }

  return (
    <Screen title="เริ่มใช้ Workspace">
      <Note>นี่คือขั้นตอนของ Workspace จริง ใน Demo Workspace ไม่มีการสร้างกุญแจหรือ Workspace ใหม่ ทำจบแล้วกลับมาที่ Demo Workspace</Note>
      <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.sm }}>
        ขั้นที่ {step + 1} จาก {STEPS.length}
      </Text>
      <Section title={current.title} footer={current.footer}>
        {current.rows.map((row) => (
          <Row key={row.title} icon={row.icon} title={row.title} detail={row.detail} />
        ))}
        {step === 1 && <ToggleRow title="จำลอง: เครื่องนี้ตั้งการล็อกหน้าจอแล้ว" value={locked} onChange={setLocked} />}
        {step === 1 && fingerprint && <Row icon="key" title="สร้างกุญแจแล้ว" detail={`รหัสกุญแจ ${fingerprint} เก็บใน Keychain ของเครื่องนี้`} mono />}
        {step === 2 && fingerprint && <Row icon="member" title="Controller นี้เป็น Owner" detail={`กุญแจ ${fingerprint}`} />}
        {step === 3 && <Row icon="machine" title="ลองทำ Pairing" detail="เปิดหน้า Pairing ของ Demo Workspace" href="/machines/pair" />}
        {step === 4 && <Row icon="device" title="ลอง Link เครื่องที่สอง" detail="เปิดหน้า Link เครื่องของ Demo Workspace" href="/devices/link" />}
      </Section>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label={last ? "กลับไป Demo Workspace" : step === 1 && !fingerprint ? "สร้างกุญแจ" : "ถัดไป"} variant="primary" onPress={next} />
        {step > 0 && <Button label="ย้อนกลับ" onPress={() => setStep(step - 1)} />}
      </View>
    </Screen>
  );
}
