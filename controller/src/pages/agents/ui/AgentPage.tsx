import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { previewOf, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Empty, Field, Note, Row, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { providerProblem } from "../model/providers";

// controller-prototype's AgentPage: the Agent's Tasks first, then its settings.
// ponytail: only what this version has. Description, instructions, Budget, Approval, Allowlist and the rest come with their changes.
function AgentView({ agent }: { agent: AgentRow }) {
  const t = useT("agents");
  const status = useT("task-status");
  const language = useLanguage();
  const colors = useColors();
  const now = useNow();
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === agent.machine_id);
  const machineStatus = useMachineStatus(agent.machine_id);
  const online = machineStatus.online;
  const tasks = (useTaskSummaries() ?? []).filter((task) => task.agent_id === agent.id);
  const [name, setName] = useState(agent.name);
  const [sent, setSent] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const offline = online === false || !link || notSent;
  const problem = providerProblem(agent, machineStatus.providers);
  const dirty = name.trim() !== agent.name;

  // The name shown is the Machine's (ADR 0006): saving waits for its list, and another device's rename comes in the same way.
  useEffect(() => {
    if (sent !== null && agent.name === sent) setSent(null);
  }, [sent, agent.name]);
  // A name not being edited follows the Machine's.
  const [shown, setShown] = useState(agent.name);
  if (shown !== agent.name) {
    setShown(agent.name);
    if (name.trim() === shown) setName(agent.name);
  }
  useEffect(() => {
    if (machineStatus.updateError) setSent(null);
  }, [machineStatus.updateError]);

  function save() {
    const next = name.trim();
    if (!next || !link || !machine) return;
    setTried(true);
    if (!link.updateAgent(machine, { id: agent.id, name: next })) return setNotSent(true);
    setSent(next);
  }

  return (
    <Screen title={agent.name} right={{ label: t("save"), onPress: save, disabled: !dirty || !name.trim() || offline || sent !== null }}>
      <View style={{ alignItems: "center", gap: space.xs }}>
        <Character look={lookOfJson(agent.character)} mood={moodOf([], online)} size={96} />
        <Text variant="footnote" tone="secondary">
          {machine?.name}
          {online === null ? "" : ` · ${t(online ? "online" : "offline")}`}
        </Text>
      </View>
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("needsOnline")}
        </Note>
      )}
      {problem && (
        <Note icon="warning" iconColor="orange">
          {problem === "provider" ? t("problem.provider", { provider: agent.provider }) : t("problem.model", { provider: agent.provider, model: agent.model })}
        </Note>
      )}

      <Section title="Task" footer={t("tasks.footer")}>
        <Row icon="add" title={t("tasks.new")} onPress={() => router.push({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: agent.id } })} />
        {tasks.map((task) => (
          <Row
            key={task.id}
            icon="thread"
            title={previewOf(task) || t("tasks.untitled")}
            detail={status(statusOf(task, online))}
            value={task.events ? when(task.updated_at, language, now) : undefined}
            href={`/tasks/${task.id}?agent=${agent.id}`}
          />
        ))}
      </Section>

      <Section title="Agent">
        <Row icon="agent" title="Character" detail={t("character.detail")} href={`/agents/${agent.id}/character`} />
        <Field label={t("name")} value={name} onChangeText={setName} />
        {sent !== null && <Row title={t("saving")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />}
      </Section>
      {tried && machineStatus.updateError && sent === null && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: machineStatus.updateError })}
        </Note>
      )}

      <Section title={t("provider.heading")} footer={t("provider.nextTask")}>
        <Row icon="key" title={problem === "provider" ? t("problem.choose") : agent.provider} detail={agent.model} href={`/agents/${agent.id}/model`} />
      </Section>
    </Screen>
  );
}

export function AgentPage() {
  const t = useT("agents");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  if (!agent) {
    return (
      <Screen title="Agent">
        <Empty icon="agent" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }
  // Keyed by the Agent so a draft name never carries over to another one.
  return <AgentView key={agent.id} agent={agent} />;
}
