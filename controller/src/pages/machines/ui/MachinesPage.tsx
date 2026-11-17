import { router } from "expo-router";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineStatuses } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { Button, Card, Chip, Empty, Icon, Screen, Section, Tap, Text, space } from "../../../shared/ui";

// The Machines board: one row per Machine with its monitor, what it runs and whether it is online.
// ponytail: OS and last-seen are not in the database yet, so the row leaves them out.
export function MachinesPage() {
  const t = useT("machines");
  const machines = useMachines();
  const agents = useAgents() ?? [];
  const statuses = useMachineStatuses();
  return (
    <Screen title="Machine" bottom={<Button label={t("pair")} variant="primary" size="large" leading="add" onPress={() => router.push("/add-machine")} />}>
      {machines?.length === 0 ? (
        <Empty icon="machine" title={t("none.title")} detail={t("none.body")} />
      ) : (
        <Section footer={t("footer")}>
          {machines?.map((machine) => {
            const status = statuses[machine.id];
            const online = status?.online ?? null;
            const count = t("agents", { count: agents.filter((a) => a.machine_id === machine.id).length });
            return (
              <Tap key={machine.id} href={`/machines/${machine.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52, paddingHorizontal: 14, paddingVertical: space.md }}>
                <Card raised style={{ width: 40, height: 40, padding: 0, borderRadius: 12, alignItems: "center", justifyContent: "center", boxShadow: "none" }}>
                  <Icon name="machine" size="md" color={online ? "green" : "tertiaryLabel"} />
                </Card>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="subheadline" strong tone={online === false ? "secondary" : "label"}>
                    {machine.name}
                  </Text>
                  <Text variant="footnote" tone="secondary" numberOfLines={1}>
                    {status?.version ? t("listLine", { version: status.version, agents: count }) : count}
                  </Text>
                </View>
                {online !== null && <Chip label={t(online ? "online" : "offline")} dot={online ? "green" : "tertiaryLabel"} />}
                <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />
              </Tap>
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
