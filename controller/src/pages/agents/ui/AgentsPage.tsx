import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAgents, useTrashedAgents, type AgentTrashRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { useNow } from "../../../shared/lib";
import { Card, confirm, Empty, Icon, inform, Note, radius, Row, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { daysLeft } from "../model/trash";

// The Agents on every paired Machine, then the ones a Machine deleted and still
// lets us restore for 30 days (controller-prototype's AgentsPage, `agent-trash`).
export function AgentsPage() {
  const t = useT("agents");
  const colors = useColors();
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
    <Screen title="Agent" right={{ label: t("create"), icon: "add", variant: "ghost", onPress: () => router.push("/agents/new") }}>
      {agents?.length === 0 ? (
        <Empty icon="agent" title={t("none.title")} detail={t("none.body")} />
      ) : (
        <Card style={{ padding: space.sm, gap: 0 }}>
          {agents?.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} asChild>
              <Pressable role="link">
                {({ pressed }) => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: pressed ? colors.chip : "transparent" }}>
                    <Character look={lookOfJson(agent.character)} mood={moodOf([], statuses[agent.machine_id]?.online ?? null)} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="headline">{agent.name}</Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        {agent.model}
                      </Text>
                      <Text variant="footnote" tone="secondary">
                        {machines.find((m) => m.id === agent.machine_id)?.name}
                        {statuses[agent.machine_id]?.online === false ? ` · ${t("offline")}` : ""}
                        {agent.budget ? ` · ${t("budget.list", { percent: Math.round(((agent.usage_tokens ?? 0) / agent.budget) * 100) })}` : ""}
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
      {trashed && trashed.length > 0 && (
        <>
          {failure && (
            <Note icon="warning" iconColor="orange">
              {describeError({ code: failure })}
            </Note>
          )}
          {/* Section already puts its rows on one Card; a Card here would nest two. */}
          <Section title={t("trash.title")} footer={t("trash.footer")}>
            {trashed.map((row) => (
              <Row
                key={row.id}
                leading={<Character look={lookOfJson(row.character)} mood={moodOf([], statuses[row.machine_id]?.online ?? null)} size={44} />}
                title={row.name}
                detail={`${machines.find((m) => m.id === row.machine_id)?.name ?? ""} · ${t("trash.days", { count: daysLeft(row, now) })}`}
                value={restoring === row.id ? t("trash.restoring") : t("trash.restore")}
                onPress={() => void restore(row)}
              />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
