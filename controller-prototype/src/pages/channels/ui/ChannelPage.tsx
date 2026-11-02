import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { chatNow, clock, deleteChannel, skipChatTime, updateChannel, useChannel, useChatSkew, validCutoff } from "../../../entities/channel";
import { can, memberName, revokeDevice, useCurrentMember, useMembers } from "../../../entities/member";
import { useTasks } from "../../../entities/task";
import { channelActive, postToChat } from "../../../features/demo-runtime";
import { authenticate, Button, confirm, Empty, Field, Note, Row, Screen, Section, space, ToggleRow } from "../../../shared/ui";
import { ChatView } from "./ChatView";

// One linked chat: its settings, the Tasks it has made, and a simulated Telegram to talk in.
export function ChannelPage() {
  const { channel: id } = useLocalSearchParams<{ channel: string }>();
  const channel = useChannel(id);
  const agents = useAgents();
  const members = useMembers();
  const tasks = useTasks();
  const me = useCurrentMember();
  useChatSkew();
  const [cutoff, setCutoff] = useState<string | null>(null);

  if (!channel || !can(me, channel.agent, "use")) {
    return (
      <Screen title="Channel">
        <Empty icon="channel" title="ไม่พบ Channel นี้" />
      </Screen>
    );
  }

  const agent = agents.find((candidate) => candidate.id === channel.agent);
  const manage = can(me, channel.agent, "manage");
  const live = channelActive(channel);
  const signer = members.find((member) => member.id === channel.signedBy);
  const device = signer?.devices.find((candidate) => candidate.id === channel.signedDevice);
  const label = `${channel.platform} · ${channel.chatName}`;
  const days = tasks.filter((task) => task.source === "channel" && task.title === label).sort((a, b) => (b.events[0]?.at ?? 0) - (a.events[0]?.at ?? 0));
  const edited = cutoff ?? channel.cutoff;

  const down = !live ? "Channel หยุดแล้ว เพราะกุญแจที่เซ็นไว้ถูกถอน ผูกใหม่ด้วยการเซ็นอีกครั้ง" : !agent?.machine.online ? `${agent?.machine.name} ปิดอยู่ bot เงียบ ข้อความที่ Telegram เก็บไว้ได้ไม่เกิน 24 ชั่วโมงจะรวมเป็น Turn เดียวตอนเครื่องกลับมา` : undefined;

  function saveCutoff() {
    if (!validCutoff(edited)) return;
    updateChannel(channel?.id ?? "", { cutoff: edited });
    setCutoff(null);
  }

  async function searchOthers(on: boolean) {
    if (on && !(await confirm({ title: "เปิดให้ bot ค้น Task อื่น?", message: "คนในแชตจะถามเรื่องใน Task ของ Agent ตัวนี้ที่ Member คนอื่นเริ่มได้", action: "เปิด" }))) return;
    updateChannel(channel?.id ?? "", { searchOthers: on });
  }

  async function unlink() {
    if (!(await confirm({ title: "เลิกผูก Channel นี้?", message: "bot จะหยุดตอบในแชต Task ที่เคยเกิดขึ้นยังอยู่ในแอป", action: "เลิกผูก", destructive: true }))) return;
    router.replace(`/channels?agent=${channel?.agent ?? ""}`);
    deleteChannel(channel?.id ?? "");
  }

  async function revoke() {
    if (!signer || !device) return;
    // Revoking the signing key is a Revocation, so it asks for the Member's unlock (ADR 0012).
    if (!(await authenticate(`ถอนกุญแจ ${device.name} ของ ${signer.name} ที่เซ็น Channel นี้`))) return;
    revokeDevice(signer.id, device.id, []);
  }

  return (
    <Screen title={channel.chatName}>
      <Section footer={down}>
        <Row icon="agent" title={agent?.name ?? "Agent"} detail={`bot @${channel.botName} · ${channel.kind === "group" ? "กลุ่ม" : "แชตส่วนตัว"}`} href={`/agents/${channel.agent}`} />
        <Row icon="key" title={`เซ็นโดย ${memberName(channel.signedBy)}`} detail={`${device?.name ?? "ไม่ทราบเครื่อง"} · ${channel.via === "claim" ? "รับด้วย /claim" : "ผูกจากแอป"}`} value={live ? (agent?.machine.online ? "ทำงาน" : "Machine ปิด") : "หยุดแล้ว"} />
      </Section>
      <Note icon="lock">
        ใน Task ของแชตนี้ Member กด Stop และตอบ Approval ได้ แต่พิมพ์ไม่ได้ เพราะสิ่งที่อยู่ใน Task คนในแชตขอให้ Agent เล่าได้ทั้งหมด Agent อ่านไฟล์ได้แค่ Workdir ของตัวเองกับ Library ที่ได้สิทธิ์ และไม่มี push ใดนอกจาก Approval
      </Note>

      <Section title="Task รายวัน" footer={`หนึ่งแชตมีหนึ่ง Task ต่อวัน ข้อความแรกหลังเวลาตัดวันเปิด Task ใหม่ หรือพิมพ์ /new ในแชต ตอนนี้เวลาในแชตคือ ${clock(chatNow())}`}>
        {days.length ? (
          days.map((task) => <Row key={task.id} icon="thread" title={label} detail={`${new Date(task.events[0]?.at ?? Date.now()).toLocaleDateString("th-TH")} · ${task.events.filter((event) => event.type === "message").length} ข้อความที่รวมแล้ว`} href={`/tasks/${task.id}`} />)
        ) : (
          <Row title="ยังไม่มี Task" detail="วันที่ไม่มีใครคุยไม่มี Task ว่าง" />
        )}
      </Section>

      {manage ? (
        <Section title="ตั้งค่า" footer="เวลาตัดวันเป็นเวลาของ Machine ค่าเริ่มต้น 04:00 เพื่อไม่ให้บทสนทนาดึกขาดกลางคัน">
          <Field label="เวลาตัดวัน (HH:MM)" value={edited} onChangeText={setCutoff} placeholder="04:00" footer={validCutoff(edited) ? undefined : "รูปแบบ HH:MM เช่น 04:00"} />
          <View style={{ flexDirection: "row", padding: space.sm }}>
            <Button label="บันทึกเวลาตัดวัน" disabled={!validCutoff(edited) || edited === channel.cutoff} onPress={saveCutoff} />
          </View>
          <ToggleRow title="ให้ bot ค้น Task อื่นของ Agent" detail="ปิดไว้: ตอบแชตนี้ ค้นได้แค่ Task ของแชตนี้" value={channel.searchOthers} onChange={searchOthers} />
          <Row icon="trash" destructive title="เลิกผูก Channel" onPress={unlink} />
        </Section>
      ) : (
        <Note>คนที่มี Manage ที่ Agent เท่านั้นที่ตั้งค่า Channel ได้</Note>
      )}

      <Section title="จำลอง Telegram">
        <ChatView
          messages={channel.chat}
          botName={channel.botName}
          hint={channel.kind === "group" ? "ในกลุ่ม bot ได้รับเฉพาะ @mention, reply และคำสั่ง" : undefined}
          samples={[`@${channel.botName} สวัสดี`, `@${channel.botName} ขอไฟล์ราคา`, `@${channel.botName} อ่าน /etc/passwd`, `@${channel.botName} รัน \`ls\``, `@${channel.botName} รัน \`npm run deploy:prod\``, "/new", "/stop", "คุยกันเอง"]}
          onSend={(name, text, replyTo) => postToChat(channel.id, name, text, replyTo)}
          disabled={!live ? "Channel หยุดแล้ว bot ไม่ตอบ" : undefined}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, padding: space.sm }}>
          <Button label="จำลอง: ข้ามไป 6 ชั่วโมง" onPress={() => skipChatTime(6 * 3_600_000)} />
          {manage && signer && device && !device.revoked && <Button label="จำลอง: ถอนกุญแจที่เซ็น" onPress={revoke} />}
        </View>
      </Section>
    </Screen>
  );
}
