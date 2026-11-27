import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { Dot, Empty, Note, Row, Screen, Section, Spinner, Text, space } from "../../../shared/ui";
import { lastRoundOf } from "../model/schedule";
import { useLastRounds } from "../model/use-last-rounds";
import { OUTCOME, useRhythm, whenShort } from "./words";

// The Agent's Schedules (issue #56) as rows, as the Agent page lists its settings: the words, when it runs and
// when next, and a dot for how the last round went. A row opens the Schedule in a sheet, where it is changed.
export function SchedulePage() {
  const t = useT("agent-schedule");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const machines = useMachines();
  const agent = agents?.find((a) => a.id === id);
  const machine = machines?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return <Screen title={t("title")}>{agents && machines && <Empty icon="time" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  return <ScheduleList key={agent.id} agentId={agent.id} agentName={agent.name} machine={machine} />;
}

function ScheduleList({ agentId, agentName, machine }: { agentId: string; agentName: string; machine: Machine }) {
  const t = useT("agent-schedule");
  const language = useLanguage();
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agentId);
  const last = useLastRounds(agentId, online);
  const rhythm = useRhythm();
  const offline = online === false || !link;
  // An Idle Work list is a Trigger too, with its own page.
  const triggers = (status.triggers ?? []).filter((trigger) => trigger.kind === "schedule");
  const open = (trigger: string) => router.push({ pathname: "/agents/[agent]/schedule/[trigger]", params: { agent: agentId, trigger } });

  // Ask on open and again when the Machine comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (link && online !== false) link.requestTriggers(machine, agentId);
  }, [link, machine.id, agentId, online]);

  return (
    <Screen title={t("title")} subtitle={agentName} right={{ label: t("add"), icon: "add", variant: "chip", onPress: () => open("new"), disabled: offline }}>
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {status.loading && !status.triggers && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <Spinner />
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
      {status.triggers && triggers.length === 0 && <Empty icon="time" title={t("empty.title")} detail={t("empty.body")} />}
      {triggers.length > 0 && (
        <Section footer={t("note")}>
          {triggers.map((trigger) => {
            const round = lastRoundOf(trigger, last.get(trigger.id));
            const when = trigger.suspended
              ? t("state.suspended")
              : trigger.pausedFor === "goal"
                ? t("state.met")
                : trigger.pausedFor === "failures"
                  ? t("state.pausedFailures")
                  : trigger.paused
                    ? t("state.paused")
                    : trigger.nextRunAt
                      ? t("state.next", { when: whenShort(trigger.nextRunAt, language) })
                      : null;
            return (
              <Row
                key={trigger.id}
                // The name the Agent gave it, as a Task's; its words until the name comes.
                title={trigger.title ?? trigger.text}
                detail={[rhythm(trigger.schedule ?? {}), when].filter(Boolean).join(" · ")}
                leading={<Dot color={trigger.suspended ? "red" : round ? OUTCOME[round.outcome].dot : "tertiaryLabel"} />}
                onPress={() => open(trigger.id)}
              />
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
