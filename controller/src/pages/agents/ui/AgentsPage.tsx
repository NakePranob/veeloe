import { Link, router } from "expo-router";
import { Pressable, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineStatuses } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { AgentAvatar, Card, Empty, Icon, radius, Screen, space, Text, useColors } from "../../../shared/ui";

// The Agents on every paired Machine (controller-prototype's AgentsPage). v0.1 has only the Owner, who has Manage on all of them.
export function AgentsPage() {
  const t = useT("agents");
  const colors = useColors();
  const agents = useAgents();
  const machines = useMachines() ?? [];
  const statuses = useMachineStatuses();
  return (
    <Screen title="Agent" right={{ label: t("create"), onPress: () => router.push("/agents/new") }}>
      {agents?.length === 0 ? (
        <Empty icon="agent" title={t("none.title")} detail={t("none.body")} />
      ) : (
        <Card style={{ padding: space.sm, gap: 0 }}>
          {agents?.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} asChild>
              <Pressable role="link">
                {({ pressed }) => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: pressed ? colors.chip : "transparent" }}>
                    <AgentAvatar backdrop={pressed ? "chip" : "fill"} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="headline">{agent.name}</Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        {agent.model}
                      </Text>
                      <Text variant="footnote" tone="secondary">
                        {machines.find((m) => m.id === agent.machine_id)?.name}
                        {statuses[agent.machine_id]?.online === false ? ` · ${t("offline")}` : ""}
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
