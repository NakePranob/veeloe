import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { chatNow, createChannel, invite, skipChatTime, usePending, CLAIM_HOURS, type Pending } from "../../../entities/channel";
import { can, thisDevice, useCurrentMember } from "../../../entities/member";
import { checkClaimCode, completeClaim, postToPending } from "../../../features/demo-runtime";
import { whyNotChannel } from "../../../features/project-rules";
import { authenticate, Button, Empty, Field, inform, Note, Row, Screen, Section, Select, space } from "../../../shared/ui";
import { ChatView } from "./ChatView";

const KIND = [
  { value: "group", label: "กลุ่ม" },
  { value: "private", label: "แชตส่วนตัวกับ bot" },
] as const;

const botFor = (name: string) => `${name.toLowerCase()}_veeloe_bot`;

// What the Member must know before signing: the chat can ask for anything the Agent can read (ADR 0028).
const WARNINGS =
  "คนในแชตไม่ได้เป็น Member และมีอำนาจเท่ากันหมด ขอให้ Agent เล่าอะไรก็ได้ที่ Agent อ่านได้ ซึ่งมีแค่ Workdir ของ Agent กับ Library ที่ได้สิทธิ์ สิ่งที่คุณเคยทิ้งไว้ใน Workdir จึงถูกขอดูได้ ค่า token ใช้ Budget ของ Agent";

function ClaimForm({ item }: { item: Pending }) {
  const me = useCurrentMember();
  const agents = useAgents();
  const [code, setCode] = useState("");
  const agent = agents.find((candidate) => candidate.id === item.agent);

  async function confirm() {
    if (!can(me, item.agent, "manage")) return inform("รับแชตไม่ได้", `ต้องมี Manage ที่ ${agent?.name}`);
    const why = checkClaimCode(item.id, code) ?? whyNotChannel(item.agent);
    if (why) return inform("ยืนยันไม่ได้", why);
    // Signing is the proof that someone with Manage took responsibility (ADR 0006, 0058).
    if (!(await authenticate(`รับแชต “${item.chatName}” ให้ ${agent?.name} งานจากแชตนี้จะทำในนามของคุณและใช้ token ของคุณ`))) return;
    const channel = completeClaim(item.id);
    if (channel) router.replace(`/channels/${channel.id}`);
  }

  return (
    <Section title={`รับแชต “${item.chatName}”`} footer="กรอกเฉพาะรหัสที่คุณเห็นเองในแชต ชื่อกลุ่มตั้งหลอกได้ จึงไม่ใช่หลักฐาน และถ้ารหัสถูกส่งต่อมาจากคนอื่นก็ยังหลอกได้">
      <Field label="รหัสที่ bot แสดงในแชต" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="6 หลัก" />
      <View style={{ flexDirection: "row", padding: space.sm }}>
        <Button label="ยืนยันและเซ็น" disabled={!code.trim()} onPress={confirm} />
      </View>
    </Section>
  );
}

export function NewChannelPage() {
  // Opened from an Agent's page, it links that Agent and asks no one to pick.
  const { claim, agent: preset } = useLocalSearchParams<{ claim?: string; agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents();
  const pending = usePending();
  const mine = agents.filter((agent) => can(me, agent.id, "manage") && (!preset || agent.id === preset));
  const [agentId, setAgentId] = useState(mine[0]?.id ?? "");
  const [chatName, setChatName] = useState("");
  const [kind, setKind] = useState<"group" | "private">("group");
  const [token, setToken] = useState("");
  const open = pending.filter((item) => item.state !== "claimed" && (!preset || item.agent === preset));
  const target = open.find((item) => item.id === claim);

  if (mine.length === 0) {
    return (
      <Screen title="ผูก Channel">
        <Empty icon="lock" title="ผูก Channel ไม่ได้" detail="ต้องมี Manage ที่ Agent ที่จะผูก" />
      </Screen>
    );
  }

  const agent = agents.find((candidate) => candidate.id === agentId);
  const blocked = agent ? whyNotChannel(agent.id) : null;
  const ready = !!chatName.trim() && token.trim().length >= 10 && !blocked;

  async function link() {
    if (!agent) return;
    const why = whyNotChannel(agent.id);
    if (why) return inform("ผูกไม่ได้", why);
    const device = thisDevice(me);
    if (!device) return;
    if (!(await authenticate(`ผูกแชต “${chatName.trim()}” กับ ${agent.name} งานจากแชตนี้จะทำในนามของคุณ`))) return;
    const channel = createChannel({ agent: agent.id, chatName: chatName.trim(), kind, botName: botFor(agent.name), signedBy: me.id, signedDevice: device.id, via: "app" });
    router.replace(`/channels/${channel.id}`);
  }

  function simulateInvite() {
    if (!agent) return;
    invite({ agent: agent.id, botName: botFor(agent.name), chatName: chatName.trim() || "กลุ่มใหม่", kind });
    setChatName("");
  }

  return (
    <Screen title="ผูก Channel" right={{ label: "ผูกและเซ็น", onPress: link, disabled: !ready }}>
      {target?.code && <ClaimForm item={target} />}
      <Section title="Agent" footer={blocked ?? "bot มีหนึ่งตัวต่อ Agent ชื่อกับรูปของ bot จึงเป็น Agent ตัวนั้นเลย Agent ที่ทำงานใน Project ผูก Channel ไม่ได้ และ Agent ที่มี Channel เข้า Project ไม่ได้"}>
        {preset ? <Row title="Agent" value={agent?.name} /> : <Row title="Agent" accessory={<Select label="Agent" value={agentId} options={mine.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={setAgentId} />} />}
        <Field label="ชื่อแชต" value={chatName} onChangeText={setChatName} placeholder="เช่น กลุ่มขาย" />
        <Row title="ชนิดแชต" accessory={<Select label="ชนิดแชต" value={kind} options={KIND} onChange={setKind} />} />
      </Section>
      <Section title="ผูกจากแอป" footer="Token ของ bot ได้จาก BotFather หนึ่ง bot ต่อหนึ่ง Agent supervisor บน Machine เก็บ token ไว้เอง worker อ่านไม่ได้ คนในแชตจึงหลอกให้ Agent บอก token ไม่ได้">
        <Field label="Token ของ bot" value={token} onChangeText={setToken} secure placeholder="123456:ABC…" />
      </Section>
      <Note icon="info" iconColor="orange">
        {WARNINGS}
      </Note>
      <Section title="จำลอง: เริ่มจากในแชต" footer="ของจริง: เชิญ bot เข้ากลุ่มด้วยมือ bot เงียบจนมีคนพิมพ์ /claim ที่นี่กดแทนการเชิญ แล้วลองพิมพ์ /claim ในแชตจำลองด้านล่าง">
        <View style={{ flexDirection: "row", padding: space.sm }}>
          <Button label={`เชิญ bot ของ ${agent?.name ?? "Agent"} เข้ากลุ่ม`} onPress={simulateInvite} />
        </View>
      </Section>
      {open.map((item) => {
        const agentName = agents.find((candidate) => candidate.id === item.agent)?.name;
        const expired = item.state === "expired";
        return (
          <View key={item.id} style={{ gap: space.lg }}>
            <Section title={`แชต “${item.chatName}” · bot ของ ${agentName}`} footer={item.code ? `คำขอหมดอายุใน ${CLAIM_HOURS} ชั่วโมง ถ้าไม่มีใครรับ bot ออกจากกลุ่มเอง` : "bot ที่ถูกเชิญแต่ยังไม่มีใครรับ เงียบทุกอย่างยกเว้นบรรทัดเดียว"}>
              <ChatView
                messages={item.chat}
                botName={item.botName}
                hint="ก่อนผูก bot ฟังแค่ /claim"
                samples={["/claim", `/claim@${item.botName}`, "/claim@other_bot", "สวัสดี"]}
                onSend={(name, text) => postToPending(item.id, name, text)}
                disabled={expired ? "คำขอหมดอายุแล้ว ต้องเชิญ bot เข้ากลุ่มใหม่" : undefined}
              />
              {!expired && item.expiresAt && (
                <View style={{ flexDirection: "row", padding: space.sm }}>
                  <Button label="จำลอง: ผ่านไป 24 ชั่วโมง" onPress={() => skipChatTime(Math.max(0, (item.expiresAt ?? 0) - chatNow()) + 1000)} />
                </View>
              )}
            </Section>
            {item.code && !expired && item.id !== target?.id && <ClaimForm item={item} />}
          </View>
        );
      })}
    </Screen>
  );
}
