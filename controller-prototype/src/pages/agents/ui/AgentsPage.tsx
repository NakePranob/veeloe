import { Link, router } from "expo-router";
import { Pressable, View } from "react-native";
import { Character, useAgents } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { Card, Empty, Icon, Screen, space, Text, useColors, radius } from "../../../shared/ui";

// The Agents this Member holds a Grant on; an Owner has Manage on all of them (CONTEXT.md).
export function AgentsPage() {
  const me = useCurrentMember();
  const colors = useColors();
  const agents = useAgents().filter((agent) => can(me, agent.id, "use"));
  return (
    <Screen title="Agent" right={me.owner ? { label: "สร้าง Agent", onPress: () => router.push("/agents/new") } : undefined}>
      {agents.length === 0 ? (
        <Empty icon="agent" title="ยังไม่มี Agent ที่คุณใช้ได้" detail={me.owner ? "สร้าง Agent ตัวแรกบน Machine ที่ผูกไว้" : "ขอ Grant จาก Owner หรือคนที่มี Manage"} />
      ) : (
        <Card style={{ padding: space.sm, gap: 0 }}>
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} asChild>
              <Pressable role="link">
                {({ pressed }) => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: pressed ? colors.chip : "transparent" }}>
                    <Character look={agent.character} mood={agent.machine.online ? "idle" : "offline"} size={44} backdrop={pressed ? "chip" : "surface"} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="headline">{agent.name}</Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        {agent.description}
                      </Text>
                      <Text variant="footnote" tone="secondary">
                        {agent.machine.name}
                        {agent.machine.online ? "" : " · ออฟไลน์"} · Budget วันนี้ {Math.round((agent.usedToday / agent.budget) * 100)}%
                      </Text>
                    </View>
                    <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />
                  </View>
                )}
              </Pressable>
            </Link>
          ))}
        </Card>
      )}
    </Screen>
  );
}
