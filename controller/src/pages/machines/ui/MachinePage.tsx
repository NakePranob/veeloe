import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { staleUsage, useAgents } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { latestEvents, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { formatTokens } from "../../../shared/lib";
import { Button, Card, Chip, Dot, Empty, Icon, Label, Meter, Row, Screen, Section, Tabs, Text, Tile } from "../../../shared/ui";
import { countsOf, ordered, shareOf } from "../model/agents";
import { AgentList, type AgentLine } from "./AgentList";
import { EgressSection } from "./EgressSection";
import { ProviderSection } from "./ProviderSection";

type Part = "agent" | "provider" | "egress" | "info";

// The Machine board: two tiles (its Agents, today's Budget), the last error, then a tab per part.
// ponytail: the board's ⋯ menu (rename, unpair) and the OS line wait for those actions and that field to exist.
export function MachinePage() {
  const t = useT("machines");
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machines = useMachines();
  const machine = machines?.find((m) => m.id === id);
  const agents = (useAgents() ?? []).filter((a) => a.machine_id === id);
  const tasks = useTaskSummaries() ?? [];
  const status = useMachineStatus(id);
  const link = useMachineLink();
  const [part, setPart] = useState<Part>("agent");
  useEffect(() => {
    if (machine) link?.requestStatus(machine);
  }, [machine?.id, link]);

  if (!machine) {
    return (
      <Screen title="Machine">
        {machines && <Empty icon="machine" title={t("missing.title")} detail={t("missing.body")} />}
      </Screen>
    );
  }

  // Each Agent by its latest Task, as the Inbox reads it; summaries come newest first.
  const lines: AgentLine[] = ordered(
    agents.map((agent) => {
      const task = tasks.find((s) => s.agent_id === agent.id);
      return { agent, status: statusOf(task, status.online), mood: moodOf(task ? latestEvents(task) : [], status.online), share: staleUsage(agent, agents) ? null : shareOf(agent.usage_tokens, agent.budget) };
    }),
  );
  const counts = countsOf(lines);
  const spent = lines.filter((line) => line.share !== null && line.share >= 1).length;
  const budget = status.budgetToday && status.budgetToday.limitTokens > 0 ? status.budgetToday : null;
  const providerTrouble = !!status.providerError || !!status.providers?.some((p) => (p as { error?: string }).error);

  return (
    <Screen title={machine.name} subtitle={status.online === null ? t("status.checking") : t(status.online ? "online" : "offline")}>
      {/* The board spaces its blocks 14 apart, closer than the Screen's sections. */}
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Tile
            height={136}
            onPress={() => setPart("agent")}
            top={
              <View aria-hidden style={{ height: 44, flexDirection: "row", alignItems: "flex-end" }}>
                {lines.slice(0, 3).map((line, i) => (
                  <View key={line.agent.id} style={{ marginLeft: i ? -10 : 0 }}>
                    <Character look={lookOfJson(line.agent.character)} mood={line.mood} size={34} backdrop="card" />
                  </View>
                ))}
                {lines.length > 3 && (
                  <Card tone="surface" style={{ marginLeft: -6, width: 34, height: 34, padding: 0, borderRadius: 17, alignItems: "center", justifyContent: "center" }}>
                    <Text variant="caption" strong tone="body">{`+${lines.length - 3}`}</Text>
                  </Card>
                )}
              </View>
            }
            value={String(agents.length)}
            unit=" Agent"
            detail={
              <View style={{ gap: 2, paddingTop: 2 }}>
                {counts.needsYou > 0 && (
                  <Count dot="orange" strong>
                    {t("tile.needsYou", { count: counts.needsYou })}
                  </Count>
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Count dot="blue">{t("tile.working", { count: counts.working })}</Count>
                  {spent > 0 && (
                    <>
                      <Text variant="caption" tone="body">
                        ·
                      </Text>
                      <Count dot="red" danger>
                        {t("tile.spent", { count: spent })}
                      </Count>
                    </>
                  )}
                </View>
              </View>
            }
          />
          <Tile
            height={136}
            href="/usage"
            top={<View style={{ height: 44, justifyContent: "center" }}>{budget && <Meter value={budget.usedTokens / budget.limitTokens} label={t("status.budget")} />}</View>}
            value={budget ? `${Math.round((budget.usedTokens / budget.limitTokens) * 100)}%` : undefined}
            unit={budget ? " Budget" : undefined}
            title={budget ? undefined : "Budget"}
            detail={budget ? t("tile.budget", { used: formatTokens(budget.usedTokens), limit: formatTokens(budget.limitTokens) }) : t("budgetUnknown")}
          />
        </View>

        {status.lastError && (
          <Card tone="warning" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Icon name="warning" size="sm" color="orange" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="footnote" strong>
                {t("status.lastError")}
              </Text>
              <Text variant="caption" mono tone="body" selectable>
                {status.lastError}
              </Text>
            </View>
            {providerTrouble && <Button variant="surface" size="small" label={t("status.seeProvider")} onPress={() => setPart("provider")} />}
          </Card>
        )}

        <Tabs<Part>
          value={part}
          onChange={setPart}
          items={[
            { value: "agent", label: "Agent" },
            { value: "provider", label: "Provider" },
            { value: "egress", label: "Egress" },
            { value: "info", label: t("tabs.info") },
          ]}
        />

        {part === "agent" && <AgentList lines={lines} online={status.online} />}
        {part === "provider" && <ProviderSection machine={machine} agents={agents} />}
        {part === "egress" && <EgressSection machine={machine} agents={agents} />}
        {part === "info" && (
          // ponytail: the board's OS row and `veeloe update` line wait for an OS field and that command.
          <Section footer={t("info.footer")}>
            <Row icon="network" title="Hub" value={machine.hub_url} />
            {status.version && <Row icon="machine" title="Runtime" value={status.version} />}
            {status.diskFreeBytes !== null && <Row icon="storage" title={t("status.disk")} value={`${(status.diskFreeBytes / 1_000_000_000).toFixed(0)} GB`} />}
            {status.features && (
              <View style={{ gap: 8, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Label icon="shield" iconColor="label" variant="subheadline" tone="label">
                  {t("status.features")}
                </Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {status.features.map((feature) => (
                    <Chip key={feature} tone="mono" label={feature} />
                  ))}
                </View>
              </View>
            )}
          </Section>
        )}
      </View>
    </Screen>
  );
}

// One count on the Agent tile: a coloured dot and its words.
function Count({ dot, strong, danger, children }: { dot: "orange" | "blue" | "red"; strong?: boolean; danger?: boolean; children: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Dot color={dot} size={7} />
      <Text variant="caption" strong={strong} tone={danger ? "danger" : strong ? "label" : "body"} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}
