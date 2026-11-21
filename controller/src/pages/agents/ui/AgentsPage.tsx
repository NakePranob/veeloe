import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { isSpent, useAgents, useTrashedAgents, type AgentTrashRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf, RETIRED_COLOR } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { statusOf, TaskStatusDot, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { useNow } from "../../../shared/lib";
import { Button, Card, Dot, Empty, Icon, Note, opacity, Screen, Section, Tap, Text, confirm, inform, space } from "../../../shared/ui";
import { daysLeft } from "../model/trash";


// The Agents board: each paired Machine's Agents under its name, then the ones a Machine deleted
// and still lets us restore for 30 days (`agent-trash`).
// ponytail: an offline Machine's "last seen" is left out: nothing stores when a Machine was last seen.
export function AgentsPage() {
  const t = useT("agents");
  const now = useNow();
  const agents = useAgents();
  const trashed = useTrashedAgents();
  const machines = useMachines() ?? [];
  const summaries = useTaskSummaries() ?? [];
  const statuses = useMachineStatuses();
  const link = useMachineLink();
  // The row that was just asked for, until the Machine's answer moves it back.
  const [restoring, setRestoring] = useState<string | null>(null);
  const failure = trashed?.map((row) => statuses[row.machine_id]?.restoreError).find(Boolean) ?? null;
  if (restoring) {
    const asking = trashed?.find((row) => row.id === restoring);
    // Gone from the trash means it is back, or the answer was an error about it.
    if (!asking || statuses[asking.machine_id]?.restoreError) setRestoring(null);
  }

  async function restore(row: AgentTrashRow) {
    if (restoring === row.id) return;
    const machine = machines.find((m) => m.id === row.machine_id);
    if (!link || !machine || statuses[row.machine_id]?.online === false) return inform(t("trash.failed"), t("needsOnline"));
    if (!(await confirm({ title: t("trash.confirmTitle", { name: row.name }), message: t("trash.confirmBody"), action: t("trash.restore"), cancel: t("cancel") }))) return;
    setRestoring(row.id);
    if (!link.restoreAgent(machine, row.id)) {
      setRestoring(null);
      inform(t("trash.failed"), t("needsOnline"));
    }
  }

  return (
    <Screen title="Agent" subtitle={agents?.length ? t("subtitle", { count: agents.length, machines: machines.length }) : undefined} right={{ label: t("create"), icon: "add", variant: "chip", onPress: () => router.push("/agents/new") }}>
      {agents?.length === 0 && <Empty icon="agent" title={t("none.title")} detail={t("none.body")} />}
      {machines.map((machine) => {
        const own = agents?.filter((agent) => agent.machine_id === machine.id) ?? [];
        if (own.length === 0) return null;
        const online = statuses[machine.id]?.online ?? null;
        return (
          <View key={machine.id} style={{ gap: space.smd, opacity: online === false ? opacity.retired : 1 }}>
            <Tap href={`/machines/${machine.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.inset, minHeight: 28 }}>
              <Dot color={online === false || online === null ? "tertiaryLabel" : "green"} />
              <Text variant="footnote" strong mono>
                {machine.name}
              </Text>
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                {t("count", { count: own.length })}
              </Text>
            </Tap>
            <Card style={{ padding: space.xs, gap: 0 }}>
              {own.map((agent) => {
                // Summaries come newest first, so the first is what the Agent did last.
                const latest = summaries.find((task) => task.agent_id === agent.id);
                const status = statusOf(latest, online);
                // Yesterday's tally is not today's, so it never says the Budget is used up.
                const spent = isSpent(agent, own) && online !== false;
                return (
                  <Tap key={agent.id} href={`/agents/${agent.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md }}>
                    <Character look={lookOfJson(agent.character)} mood={moodOf(latest?.latest_kind ? [{ kind: latest.latest_kind, body: latest.latest_body }] : [], online)} size={40} />
                    <View style={{ flex: 1, gap: space.xxs }}>
                      <Text variant="subheadline" strong numberOfLines={1} tone={online === false ? "secondary" : "label"}>
                        {`${agent.name} `}
                        <Text variant="caption" tone="secondary" mono>
                          {agent.model}
                        </Text>
                      </Text>
                      <TaskStatusDot status={status} spent={spent} />
                    </View>
                    <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />
                  </Tap>
                );
              })}
            </Card>
          </View>
        );
      })}
      {trashed && trashed.length > 0 && (
        <>
          {failure && <Note tone="warning">{describeError({ code: failure })}</Note>}
          <Section title={t("trash.title")} footer={t("trash.footer")}>
            <View style={{ padding: space.xs }}>
              {trashed.map((row) => (
                <View key={row.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md }}>
                  <View style={{ opacity: opacity.retired }}>
                    <Character look={{ ...lookOfJson(row.character), color: RETIRED_COLOR }} mood="idle" size={40} still />
                  </View>
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <Text variant="subheadline" strong tone="secondary">
                      {row.name}
                    </Text>
                    <Text variant="caption" tone="secondary">
                      <Text variant="caption" tone="secondary" mono>
                        {machines.find((m) => m.id === row.machine_id)?.name ?? ""}
                      </Text>
                      {` · ${t("trash.days", { count: daysLeft(row, now) })}`}
                    </Text>
                  </View>
                  <Button label={restoring === row.id ? t("trash.restoring") : t("trash.restore")} variant="surface" disabled={restoring === row.id} onPress={() => void restore(row)} />
                </View>
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  );
}
