import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { isSpent, staleUsage, useAgents } from "../../../entities/agent";
import { HeadStack, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { latestEvents, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { formatNumber, formatTokens } from "../../../shared/lib";
import { Button, Card, Chip, DotLabel, Empty, Icon, Label, Meter, Row, Screen, Section, space, Tabs, Text, Tile } from "../../../shared/ui";
import { errorOf } from "../../../widgets/provider-models";
import { countsOf, ordered, shareOf } from "../model/agents";
import { AgentList, type AgentLine } from "./AgentList";
import { EgressSection } from "./EgressSection";
import { ProviderSection } from "./ProviderSection";

type Part = "agent" | "provider" | "egress" | "info";

// The Machine board: two tiles (its Agents, today's Budget), the last error, then a tab per part.
// ponytail: the board's ⋯ menu (rename, unpair) and the OS line wait for those actions and that field to exist.
export function MachinePage() {
  const t = useT("machines");
  const language = useLanguage();
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
      return { agent, status: statusOf(task, status.online), mood: moodOf(task ? latestEvents(task) : [], status.online), share: staleUsage(agent, agents) ? null : shareOf(agent.usage_tokens, agent.budget), spent: isSpent(agent, agents) };
    }),
  );
  const counts = countsOf(lines);
  const spent = lines.filter((line) => line.spent).length;
  const budget = status.budgetToday && status.budgetToday.limitTokens > 0 ? status.budgetToday : null;
  const providerTrouble = !!status.providerError || !!status.providers?.some((p) => errorOf(p) !== null);

  return (
    <Screen title={machine.name} subtitle={status.online === null ? t("status.checking") : t(status.online ? "online" : "offline")}>
      {/* The board spaces its blocks 14 apart, closer than the Screen's sections. */}
      <View style={{ gap: space.inset }}>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Tile
            height={136}
            onPress={() => setPart("agent")}
            top={<HeadStack looks={lines.map((line) => ({ id: line.agent.id, look: lookOfJson(line.agent.character), mood: line.mood }))} />}
            value={String(agents.length)}
            unit={t("tile.agentUnit")}
            detail={
              <View style={{ gap: space.xxs, paddingTop: space.xxs }}>
                {counts.needsYou > 0 && (
                  <DotLabel color="orange" tone="label" strong>
                    {t("tile.needsYou", { count: counts.needsYou })}
                  </DotLabel>
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.smd }}>
                  <DotLabel color="blue">{t("tile.working", { count: counts.working })}</DotLabel>
                  {spent > 0 && (
                    <>
                      <Text variant="caption" tone="body">
                        ·
                      </Text>
                      <DotLabel color="red" tone="danger">
                        {t("tile.spent", { count: spent })}
                      </DotLabel>
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
            unit={budget ? t("tile.budgetUnit") : undefined}
            title={budget ? undefined : t("tile.budgetUnit")}
            detail={budget ? t("tile.budget", { used: formatTokens(budget.usedTokens, language), limit: formatTokens(budget.limitTokens, language) }) : t("budgetUnknown")}
          />
        </View>

        {status.lastError && (
          <Card tone="warning" style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.inset, paddingVertical: space.md }}>
            <Icon name="warning" size="sm" color="orange" />
            <View style={{ flex: 1, gap: space.xxs }}>
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
            {status.diskFreeBytes !== null && <Row icon="storage" title={t("status.disk")} value={t("status.diskFree", { size: formatNumber(Math.round(status.diskFreeBytes / 1_000_000_000), language) })} />}
            {status.features && (
              <View style={{ gap: space.sm, paddingHorizontal: space.inset, paddingVertical: space.md }}>
                <Label icon="shield" iconColor="label" variant="subheadline" tone="label">
                  {t("status.features")}
                </Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
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

