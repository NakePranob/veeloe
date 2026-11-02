import { View } from "react-native";
import { useAgents, type UsageSource } from "../../../entities/agent";
import { can, memberName, useCurrentMember } from "../../../entities/member";
import { formatTokens } from "../../../shared/lib";
import { Empty, Icon, Meter, Note, Row, Screen, Section, space, Text } from "../../../shared/ui";

const SOURCES: UsageSource[] = ["Task", "Schedule", "Idle Work", "Watch", "Channel"];

// Tokens, not money: prices differ by model and gateway, so the Budget counts what the Provider
// reports (ADR 0043).
export function UsagePage() {
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  // Per-Member numbers are for the Owner and for those who manage that Agent (ADR 0043, 0059).
  const managed = agents.filter((agent) => can(me, agent.id, "manage"));
  const perMember = new Map<string, { total: number; by: string[] }>();
  for (const agent of managed) {
    for (const [member, tokens] of Object.entries(agent.usageByMember)) {
      const row = perMember.get(member) ?? { total: 0, by: [] };
      row.total += tokens;
      row.by.push(`${agent.name} ${formatTokens(tokens)}`);
      perMember.set(member, row);
    }
  }
  const members = [...perMember].sort((a, b) => b[1].total - a[1].total);

  if (agents.length === 0) {
    return (
      <Screen title="การใช้ token">
        <Empty icon="usage" title="ยังไม่มี Agent ที่คุณใช้ได้" />
      </Screen>
    );
  }
  return (
    <Screen title="การใช้ token">
      <Note>นับทุก token ที่ Provider รายงาน ทั้ง input ที่อ่านจาก cache และ output วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine แนะนำให้ตั้ง spend limit ที่ Provider ไว้ด้วยเป็นเพดานเงินจริงชั้นสุดท้าย (ADR 0043)</Note>
      {agents.map((agent) => {
        const share = agent.usedToday / agent.budget;
        return (
          <Section key={agent.id} title={`${agent.name} วันนี้`}>
            <View style={{ gap: space.sm, padding: space.sm }}>
              <Meter value={share} label={`Budget วันนี้ของ ${agent.name}`} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                {share >= 0.8 && <Icon name="info" size="sm" color={share >= 1 ? "red" : "orange"} />}
                <Text variant="footnote" tone="secondary">
                  {formatTokens(agent.usedToday)} จาก {formatTokens(agent.budget)} token ({Math.round(share * 100)}%)
                </Text>
              </View>
            </View>
            {SOURCES.map((source) => (
              <Row key={source} title={source} value={`${formatTokens(agent.usageBySource[source] ?? 0)} token`} />
            ))}
          </Section>
        );
      })}
      {managed.length > 0 ? (
        <Section title="เดือนนี้ ต่อ Member" footer="นับตามคนที่งานทำในนามเขา ไม่มีเพดานต่อคน Budget เป็นก้อนเดียวต่อ Agent การแบ่งค่าใช้จ่ายเป็นเรื่องนอกระบบ แสดงเฉพาะ Agent ที่คุณมี Manage (ADR 0059)">
          {members.length === 0 && <Row title="ยังไม่มีการใช้เดือนนี้" />}
          {members.map(([member, row]) => (
            <Row key={member} icon="member" title={memberName(member)} detail={row.by.join(" · ")} value={`${formatTokens(row.total)} token`} />
          ))}
        </Section>
      ) : (
        <Note icon="lock">ยอดต่อ Member เห็นได้เฉพาะ Owner และคนที่มี Manage ที่ Agent นั้น</Note>
      )}
    </Screen>
  );
}
