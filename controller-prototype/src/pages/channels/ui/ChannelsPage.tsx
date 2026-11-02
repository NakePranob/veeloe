import { router, useLocalSearchParams } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { useChannels, usePending } from "../../../entities/channel";
import { can, memberName, useCurrentMember, useMembers } from "../../../entities/member";
import { channelActive } from "../../../features/demo-runtime";
import { Empty, Note, Row, Screen, Section } from "../../../shared/ui";

export function ChannelsPage() {
  const { agent: only } = useLocalSearchParams<{ agent?: string }>();
  const channels = useChannels();
  const pending = usePending();
  const agents = useAgents();
  const me = useCurrentMember();
  useMembers();
  const shown = (agentId: string) => !only || agentId === only;
  const mine = channels.filter((channel) => shown(channel.agent) && can(me, channel.agent, "use"));
  const claims = pending.filter((item) => shown(item.agent) && item.state === "open" && item.code && can(me, item.agent, "manage"));
  const mayLink = agents.some((agent) => shown(agent.id) && can(me, agent.id, "manage"));
  return (
    <Screen title="Channel" right={mayLink ? { label: "ผูก Channel", onPress: () => router.push(only ? `/channels/new?agent=${only}` : "/channels/new") } : undefined}>
      <Note>Channel คือแชตข้างนอก เช่น กลุ่ม Telegram ที่ผูกกับ Agent หนึ่งตัว ใครในแชตก็คุยกับ Agent ได้ งานทำในนามของคนที่ผูกและเซ็น และใช้ Budget ของ Agent</Note>
      {claims.length > 0 && (
        <Section title="คำขอ /claim ที่รออยู่" footer="รหัสแสดงอยู่ในแชตเท่านั้น คนที่ไม่ได้อยู่ในแชตจึงยืนยันไม่ได้">
          {claims.map((item) => (
            <Row key={item.id} icon="key" title={item.chatName} detail={`bot ของ ${agents.find((agent) => agent.id === item.agent)?.name}`} value="กรอกรหัส" href={`/channels/new?claim=${item.id}`} />
          ))}
        </Section>
      )}
      {mine.length === 0 ? (
        <Empty icon="channel" title="ยังไม่มี Channel" detail={mayLink ? "ผูกกลุ่ม Telegram กับ Agent จากแอป หรือเชิญ bot เข้ากลุ่มแล้วพิมพ์ /claim" : "ต้องมี Manage ที่ Agent ถึงจะผูก Channel ได้"} />
      ) : (
        <Section>
          {mine.map((channel) => {
            const agent = agents.find((candidate) => candidate.id === channel.agent);
            const live = channelActive(channel);
            return (
              <Row
                key={channel.id}
                icon="channel"
                iconColor={live && agent?.machine.online ? "green" : "tertiaryLabel"}
                title={`${channel.platform} · ${channel.chatName}`}
                detail={`${agent?.name} · เซ็นโดย ${memberName(channel.signedBy)}${channel.via === "claim" ? " (/claim)" : ""}`}
                value={!live ? "หยุดแล้ว" : agent?.machine.online ? "ทำงาน" : "Machine ปิด"}
                href={`/channels/${channel.id}`}
              />
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
