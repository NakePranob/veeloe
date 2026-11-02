import { useState } from "react";
import { useMachines } from "../../../entities/agent";
import { DELETE_WAIT, FREE_MACHINES, quota, updateAccount, useAccount } from "../../../entities/account";
import { useCurrentMember, useMembers } from "../../../entities/member";
import { owners } from "../../../features/membership";
import { Field, inform, Row, Screen, Section } from "../../../shared/ui";
import { cancelDeletion, finishDeletion, lastOwner, requestDeletion, sendRecovery, tryPairing, verifyRecovery } from "../model/account";

const DAY = 86_400_000;

// The Hub account: email, recovery, the plan and its quota, and deleting it (ADR 0001, 0013, 0024, 0063).
export function AccountPage() {
  const me = useCurrentMember();
  useMembers();
  const account = useAccount();
  const machines = useMachines();
  const [code, setCode] = useState("");
  const run = (why: string | null) => why && inform("ทำไม่ได้", why);
  const limit = quota(account);
  const keys = me.devices.filter((device) => !device.revoked).length;
  const revoked = me.devices.length - keys;

  if (account.deleted) {
    return (
      <Screen title="บัญชี">
        <Section title="Workspace ถูกลบที่ Hub แล้ว" footer="Hub ลบข้อมูลทั้งหมดและไม่รับ Machine ของ Workspace นี้อีก Runtime จะแสดงสถานะนี้ใน CLI และต่อใหม่ถี่น้อยลง แต่ไม่ลบอะไรบนเครื่องและไม่หยุดลองถาวร เพราะ Hub ที่โดนเจาะปลอมคำตอบนี้ได้">
          <Row icon="failed" iconColor="red" title="ทุกคำสั่งถูกปฏิเสธ" />
          <Row icon="machine" title="ที่ยังอยู่บนเครื่องของคุณ" detail="ประวัติ Task, Agent, Workdir, Memory และ Library ข้อมูลของคุณบนเครื่องของคุณ" />
          <Row icon="file" mono title="veeloe unpair" detail="รันบน Machine เองถ้าอยากเก็บกวาดและเลิกผูก" />
        </Section>
      </Screen>
    );
  }

  const deletion = account.deletion;
  const frozenForMe = !!deletion && (deletion.workspace || deletion.member === me.id);
  const others = owners().filter((owner) => owner.id !== me.id).length;

  return (
    <Screen title="บัญชี">
      <Section title="บัญชีที่ Hub" footer="email ใช้กับ billing และกู้บัญชีเท่านั้น ใช้สั่งหรือดู Machine ไม่ได้ ไม่มีรหัสผ่านให้หลุดหรือลืม ตัวตนของคุณคือกุญแจบนเครื่อง">
        <Row icon="mail" title="email" value={account.email} />
        <Row icon="device" title="Link เครื่องใหม่ด้วย email" href="/devices/link-login" />
      </Section>

      <Section title="ถ้า Controller หายหมดทุกเครื่อง" footer="การกู้ด้วย email คืนให้แค่บัญชีที่ Hub ไม่ใช่สิทธิ์เข้า Machine">
        {account.recovery === "idle" && <Row icon="key" title="กู้บัญชีด้วย email" detail={`ส่งรหัสไปที่ ${account.email}`} onPress={sendRecovery} />}
        {account.recovery === "sent" && (
          <>
            <Row icon="mail" title="ส่งรหัสไปที่ email แล้ว" detail={`จำลอง: รหัสในจดหมายคือ ${account.recoveryCode}`} />
            <Field label="รหัสจาก email" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Row icon="done" iconColor="green" title="ยืนยันรหัส" onPress={() => { const why = verifyRecovery(code); if (!why) setCode(""); run(why); }} />
            <Row icon="restart" title="ส่งรหัสใหม่" onPress={sendRecovery} />
          </>
        )}
        {account.recovery === "recovered" && (
          <>
            <Row icon="done" iconColor="green" title="ได้บัญชีที่ Hub คืนแล้ว" detail="email, plan และ billing" />
            <Row icon="failed" iconColor="red" title="ยังไม่ได้คืน" detail="Machine, Agent, ประวัติ Task และกุญแจของ Controller เครื่องไหนก็ตาม" />
            <Row
              icon="members"
              title={others > 0 ? "ให้ Owner อีกคนเชิญกลับ" : "ทำ Pairing ใหม่ที่หน้าเครื่อง"}
              detail={others > 0 ? `Workspace มี Owner อีก ${others} คน ให้เขาออก Invitation แล้วเทียบรหัสกัน ไม่ต้อง Pair Machine ใหม่ (ADR 0031)` : "คุณเป็น Owner คนเดียว รัน veeloe unpair ที่ Machine แล้ว Pairing ใหม่ Agent และประวัติไม่ตามมา (ADR 0031, 0035)"}
            />
            <Row icon="restart" title="เริ่มใหม่" onPress={() => updateAccount({ recovery: "idle" })} />
          </>
        )}
      </Section>

      <Section
        title="แผนและโควตา"
        footer="Member และ Agent ไม่คิดเงิน ชวนคนมาเป็น Approver ได้เต็มที่ การสมัครและการจ่ายเงินทำบนเว็บเท่านั้น แอปไม่แสดงราคาและไม่มีปุ่มซื้อ"
      >
        <Row icon="machine" title="Machine ที่ Pair แล้ว" value={`${machines.length} จาก ${limit}`} />
        <Row icon="card" title="ฟรี" value={`${FREE_MACHINES} Machine`} />
        <Row icon="card" title="คิดเงินต่อ Machine ที่ Pair" detail="จัดการบนเว็บ" value={account.subscription === "active" ? `${account.paidMachines} Machine` : "ยกเลิกแล้ว"} />
        <Row icon="add" title="จำลอง: Pair Machine ใหม่" detail="Hub ตรวจโควตาตอน Pairing ถ้าเกินจะบอกแค่ว่าเกินโควตา" onPress={async () => run(await tryPairing(me))} />
      </Section>
      <Section title="ทดลอง" footer="จำลองสิ่งที่เกิดบนเว็บ: เจ้าของเปลี่ยนจำนวน Machine ที่จ่ายเงิน แล้ว Hub ส่งโควตาใหม่มาที่แอป">
        <Row icon="demo" title="จำลอง: เพิ่ม Machine ที่จ่ายเงินบนเว็บ" onPress={() => updateAccount({ paidMachines: account.paidMachines + 1, subscription: "active" })} />
        <Row icon="demo" title="จำลอง: ลด Machine ที่จ่ายเงินบนเว็บ" onPress={() => updateAccount({ paidMachines: Math.max(0, account.paidMachines - 1) })} />
      </Section>

      <Section title="การเข้ารหัส E2E" footer="E2E กัน Hub ไม่ให้อ่านเนื้อหา ไม่ได้กันคนที่ไว้ใจเนื้อหาอยู่แล้ว (ADR 0063)">
        <Row icon="lock" iconColor="green" title="Hub อ่านไม่ได้" detail="เนื้อหาของ Task ทั้งหมด รวม Attachment ชื่อและสรุปของเส้น เข้ารหัสระหว่าง Controller กับ Runtime Hub เห็นแค่ผู้ส่ง รายชื่อผู้รับ รหัส Task และเวลา" />
        <Row icon="warning" iconColor="orange" title="ยังอ่านได้" detail="Runtime และเจ้าของ Machine (Agent ต้องใช้เนื้อหา), Provider ที่รับ prompt, Telegram ที่รับข้อความของ Channel" />
        <Row icon="warning" iconColor="orange" title="ยังไม่ปกป้อง" detail="ใครรู้ว่าใครคุยกับใคร เมื่อไหร่ มากแค่ไหน, forward secrecy (ใครได้กุญแจถอดรหัสพร้อมข้อความที่ดักเก็บไว้ อ่านย้อนหลังได้), คนที่เคยมีสิทธิ์ที่เก็บสำเนาไว้เอง" />
        <Row icon="key" title="กุญแจถอดรหัสของแต่ละเครื่อง" detail={`${keys} เครื่องของคุณมีกุญแจ และ Runtime ห่อข้อความให้ ${revoked ? `ถอนแล้ว ${revoked} เครื่อง Runtime เลิกใส่ในรายชื่อผู้รับ` : "ไม่มีเครื่องที่ถอนแล้ว"} แยกจากกุญแจเซ็นที่ล็อกด้วย Face ID จึงอ่านได้ตอนแอปอยู่เบื้องหลัง ป้องกันน้อยกว่ากุญแจเซ็น`} href="/devices" />
      </Section>

      <Section
        title="ลบบัญชี"
        footer="ข้อมูลบนเครื่องของคุณอยู่ต่อเสมอ: ประวัติ Task, Agent, Workdir และ Memory เพราะเป็นของคุณบนเครื่องของคุณ Runtime ไม่ลบอะไรจากระยะไกล ถ้าอยากเก็บกวาดเองให้รัน veeloe unpair ที่ Machine"
      >
        {!deletion && <Row icon="trash" destructive title="ลบบัญชี" detail={lastOwner(me) ? "คุณเป็น Owner คนสุดท้าย จะลบ Workspace ด้วย" : "รอ 30 วันก่อนลบจริง"} onPress={async () => run(await requestDeletion(me))} />}
        {deletion && (
          <>
            <Row icon="time" iconColor="orange" title={deletion.workspace ? "Workspace ถูกแช่แข็ง" : frozenForMe ? "บัญชีของคุณถูกแช่แข็ง" : "มีบัญชีรอลบ"} detail={`ลบจริงอีก ${Math.ceil((deletion.deleteAt - Date.now()) / DAY)} วัน (ครบ ${DELETE_WAIT / DAY} วัน) Hub ปฏิเสธทุกคำสั่ง ยกเว้นยกเลิกการลบ`} />
            {deletion.workspace && <Row icon="card" title="subscription ถูกยกเลิกแล้ว" />}
            <Row icon="done" title="ยกเลิกการลบ" detail="เซ็นคำสั่งด้วยกุญแจของ Controller เดิม" onPress={async () => run(await cancelDeletion())} />
            <Row icon="demo" title="จำลอง: ครบ 30 วัน" detail="Hub ลบข้อมูลจริง" onPress={finishDeletion} />
          </>
        )}
      </Section>
    </Screen>
  );
}
