import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgents, useTrashedAgents, type AgentTrashRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { useNow } from "../../../shared/lib";
import { Button, Card, Empty, Icon, Note, Screen, Section, Tap, Text, confirm, inform, space } from "../../../shared/ui";
import { daysLeft } from "../model/trash";

// The Agents on every paired Machine, then the ones a Machine deleted and still
// lets us restore for 30 days (controller-prototype's AgentsPage, `agent-trash`).
export function AgentsPage() {
  const t = useT("agents");
  const now = useNow();
  const agents = useAgents();
  const trashed = useTrashedAgents();
  const machines = useMachines() ?? [];
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
    if (!(await confirm({ title: t("trash.confirmTitle", { name: row.name }), message: t("trash.confirmBody"), action: t("trash.restore"), cancel: t("delete.cancel") }))) return;
    setRestoring(row.id);
    if (!link.restoreAgent(machine, row.id)) {
      setRestoring(null);
      inform(t("trash.failed"), t("needsOnline"));
    }
  }

  return (
    <Screen title="Agent" bottom={<Button label={t("create")} variant="primary" size="large" leading="add" onPress={() => router.push("/agents/new")} />}>
      {agents?.length === 0 ? (
        <Empty icon="agent" title={t("none.title")} detail={t("none.body")} />
      ) : (
        <Card style={{ padding: 6, gap: 0 }}>
          {agents?.map((agent) => {
            const online = statuses[agent.machine_id]?.online ?? null;
            const percent = agent.budget ? Math.round(((agent.usage_tokens ?? 0) / agent.budget) * 100) : null;
            const spent = percent !== null && percent >= 100;
            return (
              <Tap key={agent.id} href={`/agents/${agent.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: 10, borderRadius: 16 }}>
                <Character look={lookOfJson(agent.character)} mood={moodOf([], online)} size={52} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text strong tone={online === false ? "secondary" : "label"} style={{ fontSize: 16 }}>
                    {agent.name}
                  </Text>
                  <Text variant="caption" tone="secondary" mono numberOfLines={1}>
                    {agent.model}
                  </Text>
                  <Text variant="footnote" tone="secondary" numberOfLines={1}>
                    {machines.find((m) => m.id === agent.machine_id)?.name}
                    {online === false ? ` · ${t("offline")}` : ""}
                    {percent !== null && online !== false ? (
                      <Text variant="footnote" strong={spent} tone={spent ? "danger" : "secondary"}>
                        {` · ${t("budget.list", { percent })}${spent ? t("budget.spent") : ""}`}
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <Icon name="disclosure" size="sm" color="secondaryLabel" weight="semibold" />
              </Tap>
            );
          })}
        </Card>
      )}
      {trashed && trashed.length > 0 && (
        <>
          {failure && (
            <Note icon="warning" iconColor="orange">
              {describeError({ code: failure })}
            </Note>
          )}
          <Section title={t("trash.title")} footer={t("trash.footer")}>
            <View style={{ padding: 6 }}>
              {trashed.map((row) => (
                <View key={row.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: 10 }}>
                  <View style={{ opacity: 0.6 }}>
                    <Character look={lookOfJson(row.character)} mood="idle" size={44} still />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="subheadline" strong tone="secondary">
                      {row.name}
                    </Text>
                    <Text variant="footnote" tone="secondary">
                      {`${machines.find((m) => m.id === row.machine_id)?.name ?? ""} · ${t("trash.days", { count: daysLeft(row, now) })}`}
                    </Text>
                  </View>
                  <Button label={restoring === row.id ? t("trash.restoring") : t("trash.restore")} variant="surface" size="small" disabled={restoring === row.id} onPress={() => void restore(row)} />
                </View>
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  );
}
