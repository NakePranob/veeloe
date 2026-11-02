import { useState } from "react";
import { useAccount } from "../../../entities/account";
import { useLinkRequests, type LinkRequest } from "../../../entities/linking";
import { useCurrentMember, type Device } from "../../../entities/member";
import { Field, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";
import { codesOf, decide, startLogin } from "../model/link";

const KINDS = [
  { value: "phone", label: "มือถือ" },
  { value: "tablet", label: "แท็บเล็ต" },
  { value: "web", label: "เว็บ" },
] as const;

const STAGE = { waiting: "รอเครื่องเดิม", approved: "Link แล้ว", denied: "ถูกปฏิเสธ" } as const;

function Request({ request, memberId }: { request: LinkRequest; memberId: string }) {
  const { newDevice, oldDevice } = codesOf(request.key, request.seenKey);
  const run = async (matches: boolean) => {
    const why = await decide(request.id, memberId, matches);
    if (why) inform("ทำไม่ได้", why);
  };
  return (
    <Section title={`${request.deviceName} · ${STAGE[request.stage]}`}>
      {request.stage === "waiting" && (
        <>
          <Row icon="device" title="รหัสบนเครื่องใหม่" detail={newDevice.join(" · ")} />
          <Row icon="shield" title="รหัสบนเครื่องเดิมนี้" detail={oldDevice.join(" · ")} />
          <Row icon="info" title="เทียบรหัสสองเครื่องด้วยตาตัวเอง" detail="ถ้าตรงกัน และคุณเป็นคนกำลังเปิดเครื่องใหม่อยู่ จึงอนุมัติ" />
          <Row icon="done" iconColor="green" title="รหัสตรงกัน อนุมัติ" onPress={() => run(true)} />
          <Row icon="failed" iconColor="red" title="ไม่ใช่ฉัน หรือรหัสไม่ตรง ปฏิเสธ" onPress={() => run(false)} />
        </>
      )}
      {request.stage === "approved" && <Row icon="done" iconColor="green" title="เซ็นรับรองแล้ว" detail="เครื่องใหม่เข้ามาอยู่ในรายการเครื่องของคุณ" href="/devices" />}
      {request.stage === "denied" && <Row icon="failed" iconColor="red" title="ไม่ได้ Link" detail={request.refusal} />}
    </Section>
  );
}

// Linking a new device by logging in at the Hub; the old device vouches for it (ADR 0013, 0031).
export function LinkLoginPage() {
  const me = useCurrentMember();
  const account = useAccount();
  const requests = useLinkRequests().filter((request) => request.member === me.id);
  const [email, setEmail] = useState(account.email);
  const [name, setName] = useState(`แท็บเล็ตของ ${me.name}`);
  const [kind, setKind] = useState<Device["kind"]>("tablet");
  const [swapped, setSwapped] = useState(false);

  const login = () => {
    const why = startLogin(me.id, email, name, kind, swapped);
    if (why) inform("เข้าสู่ระบบไม่ได้", why);
  };

  return (
    <Screen title="Link ด้วย email" right={{ label: "เข้าสู่ระบบ", onPress: login, disabled: !email.trim() }}>
      <Note icon="warning" iconColor="orange">
        login ที่ Hub ไม่ได้พิสูจน์ว่าเป็นคุณ มีไว้ให้ Hub หาเจ้าของเจอเท่านั้น คนที่ได้ email ไปทำได้แค่ส่งคำขอที่คุณจะเห็นและปฏิเสธ การรับรองจริงคือเครื่องเดิมของคุณเทียบรหัสแล้วเซ็น
      </Note>
      <Section title="ที่เครื่องใหม่" footer="จำลองหน้าจอของเครื่องใหม่: เปิดแอป เลือก login ด้วย email แล้วกรอก email ของบัญชี ไม่มีรหัสผ่าน">
        <Field label="email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field label="ชื่อเครื่องใหม่" value={name} onChangeText={setName} />
        <Row icon="device" title="ชนิดเครื่อง" accessory={<Select label="ชนิดเครื่อง" value={kind} options={KINDS} onChange={setKind} />} />
        <ToggleRow icon="warning" title="จำลอง: Hub สลับกุญแจระหว่างทาง" detail="รหัสบนเครื่องเดิมจะไม่ตรงกับเครื่องใหม่" value={swapped} onChange={setSwapped} />
      </Section>
      <Section title="ที่เครื่องเดิม (เครื่องนี้)" footer="Hub ส่งคำขอเป็น push มาที่เครื่องเดิม ซึ่งบอกแค่ว่ามีคำขอรออยู่ ไม่บอกรายละเอียด การอนุมัติต้องยืนยันตัวตนด้วย Face ID">
        {requests.length === 0 ? <Row icon="bell" title="ยังไม่มีคำขอ" detail="กด เข้าสู่ระบบ ที่มุมขวาบนเพื่อจำลองเครื่องใหม่" /> : null}
      </Section>
      {requests.map((request) => (
        <Request key={request.id} request={request} memberId={me.id} />
      ))}
    </Screen>
  );
}
