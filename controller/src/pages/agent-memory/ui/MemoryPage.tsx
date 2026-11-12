import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useMemoryStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Empty, Note, Screen, Section, space, Text, useColors } from "../../../shared/ui";

// The count is shown against the same cap `runtime-core` applies to the prompt. It is fixed in
// v0.1 (ADR 0036), so it lives here as a constant: when `MEMORY_LIMIT` moves, this must move too.
export const MEMORY_LIMIT = 4_000;

/** The Agent's Memory, read-only: what its next Turn's prompt gets from `MEMORY.md` (ADR 0036). */
export function MemoryPage() {
  const { agent: agentParam } = useLocalSearchParams<{ agent?: string }>();
  const t = useT("agent-memory");
  const language = useLanguage();
  const now = useNow();
  const colors = useColors();
  const link = useMachineLink();
  const agents = useAgents();
  const machines = useMachines() ?? [];
  const agent = agents?.find((row) => row.id === agentParam);
  const machine = machines.find((row) => row.id === agent?.machine_id);
  const machineStatus = useMachineStatus(machine?.id ?? "");
  const status = useMemoryStatus(machine?.id ?? "", agent?.id ?? "");
  const online = machineStatus.online;
  const memory = status.memory;

  // Ask on open and again when the Machine comes back; reading never writes anything.
  useEffect(() => {
    if (link && machine && agent && online !== false) link.requestMemory(machine, agent.id);
  }, [link, machine?.id, agent?.id, online]);

  if (agents && (!agent || !machine)) {
    return (
      <Screen title={t("title")}>
        <Empty icon="memory" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t("title")}
      right={
        machine && agent
          ? { label: t("refresh"), variant: "ghost", onPress: () => void link?.requestMemory(machine, agent.id) }
          : undefined
      }
    >
      <Note>{t("note")}</Note>
      {online === false && (
        <Note icon="offline" iconColor="orange">
          {t("needsOnline")}
        </Note>
      )}
      {status.loading && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <ActivityIndicator color={colors.secondaryLabel} />
          <Text variant="footnote" tone="secondary">
            {t("loading")}
          </Text>
        </View>
      )}
      {status.error && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.error })}
        </Note>
      )}
      {memory && !memory.exists && <Empty icon="memory" title={t("empty.title")} detail={t("empty.body")} />}
      {memory?.exists && (
        <Section title={t("heading")}>
          <View style={{ gap: space.sm, padding: space.sm }}>
            <Text variant="footnote" tone="secondary">
              {t("count", { chars: memory.chars, limit: MEMORY_LIMIT })}
            </Text>
            {memory.chars > MEMORY_LIMIT && (
              <Text variant="footnote" tone="secondary">
                {t("capped", { limit: MEMORY_LIMIT })}
              </Text>
            )}
            {memory.text ? (
              // Plain text only: Memory is Agent-written and may be poisoned, so nothing here
              // is interpreted as Markdown or HTML, and nothing is tappable.
              <Text variant="subheadline" mono style={{ backgroundColor: colors.fill, padding: space.sm }}>
                {memory.text}
              </Text>
            ) : (
              <Text tone="secondary">{t("blank")}</Text>
            )}
          </View>
        </Section>
      )}
      {memory && status.fetchedAt ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.sm }}>
          {t("fetched", { when: when(status.fetchedAt, language, now) })}
        </Text>
      ) : null}
    </Screen>
  );
}
