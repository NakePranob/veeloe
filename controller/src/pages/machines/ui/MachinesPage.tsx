import { router } from "expo-router";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineStatuses } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { formatTokens } from "../../../shared/lib";
import { Button, Dot, Empty, Icon, Meter, opacity, Screen, Section, size, Tap, Text, Tile, space } from "../../../shared/ui";

// The Machines board: how many are online and today's Budget across them, then one card of Machines.
// ponytail: OS and last-seen are not in the database yet, so the row's line leaves them out.
export function MachinesPage() {
  const t = useT("machines");
  const language = useLanguage();
  const machines = useMachines();
  const agents = useAgents() ?? [];
  const statuses = useMachineStatuses();
  const list = machines ?? [];
  const online = list.filter((m) => statuses[m.id]?.online).length;
  const budgets = list.map((m) => statuses[m.id]?.budgetToday).filter((b): b is NonNullable<typeof b> => !!b && b.limitTokens > 0);
  const limit = budgets.reduce((sum, b) => sum + b.limitTokens, 0);
  const share = limit > 0 ? budgets.reduce((sum, b) => sum + b.usedTokens, 0) / limit : null;
  const pair = () => router.push("/add-machine");

  return (
    <Screen title="Machine" right={{ label: t("pair"), icon: "add", onPress: pair }}>
      {machines?.length === 0 ? (
        <Empty icon="machine" title={t("none.title")} detail={t("none.body")} action={<Button label={t("pair")} variant="primary" leading="add" onPress={pair} />} />
      ) : (
        <View style={{ gap: 18 }}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Tile
              top={<Caption>{t("online")}</Caption>}
              value={String(online)}
              unit={t("tile.ofCount", { count: list.length })}
              detail={
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, paddingTop: space.xxs }}>
                  {list.map((m) => (
                    <Dot key={m.id} color={statuses[m.id]?.online ? "green" : "tertiaryLabel"} />
                  ))}
                </View>
              }
            />
            <Tile
              top={<Caption>{t("budgetTotal")}</Caption>}
              value={share === null ? undefined : `${Math.round(share * 100)}%`}
              detail={
                share === null ? (
                  t("budgetUnknown")
                ) : (
                  <View style={{ paddingTop: space.smd }}>
                    <Meter value={share} label={t("budgetTotal")} />
                  </View>
                )
              }
            />
          </View>
          <Section footer={t("footer")}>
            {list.map((machine) => {
              const status = statuses[machine.id];
              const on = status?.online ?? null;
              const budget = status?.budgetToday;
              const count = t("agents", { count: agents.filter((a) => a.machine_id === machine.id).length });
              return (
                <Tap
                  key={machine.id}
                  href={`/machines/${machine.id}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.row, paddingHorizontal: space.inset, paddingVertical: space.md, opacity: on === false ? opacity.retired : 1 }}
                >
                  <Icon name="machine" size="md" color={on ? "green" : "tertiaryLabel"} />
                  <View style={{ flex: 1, gap: space.smd }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                      <Text variant="subheadline" strong numberOfLines={1} style={{ flex: 1 }}>
                        {machine.name}
                      </Text>
                      {on === false ? (
                        <Text variant="caption" tone="body">
                          {formatTokens(0, language)}
                        </Text>
                      ) : (
                        budget && (
                          <Text variant="caption" tone="body" style={{ fontVariant: ["tabular-nums"] }}>
                            {budget.limitTokens > 0 ? t("usedOf", { used: formatTokens(budget.usedTokens, language), limit: formatTokens(budget.limitTokens, language) }) : formatTokens(budget.usedTokens, language)}
                          </Text>
                        )
                      )}
                    </View>
                    {on !== false && budget && budget.limitTokens > 0 && <Meter value={budget.usedTokens / budget.limitTokens} label={t("status.budget")} />}
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {on === null ? count : t("listLine", { status: t(on ? "online" : "offline"), agents: count })}
                    </Text>
                  </View>
                  <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />
                </Tap>
              );
            })}
          </Section>
        </View>
      )}
    </Screen>
  );
}

function Caption({ children }: { children: string }) {
  return (
    <Text variant="caption" strong tone="secondary">
      {children}
    </Text>
  );
}
