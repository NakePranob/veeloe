import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { previewOf, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineStatus } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { Empty, Row, Screen, Section, space, Text } from "../../../shared/ui";

// controller-prototype's AgentPage: the Agent's Tasks first, then its settings.
// ponytail: only what this version has. Name, instructions, Budget, Approval, Allowlist and the rest come with their changes.
export function AgentPage() {
  const t = useT("agents");
  const status = useT("task-status");
  const language = useLanguage();
  const now = useNow();
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  const online = useMachineStatus(agent?.machine_id ?? "").online;
  const tasks = (useTaskSummaries() ?? []).filter((task) => task.agent_id === id);

  if (!agent) {
    return (
      <Screen title="Agent">
        <Empty icon="agent" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }

  return (
    <Screen title={agent.name}>
      <View style={{ alignItems: "center", gap: space.xs }}>
        <Character look={lookOfJson(agent.character)} mood={moodOf([], online)} size={96} />
        <Text variant="footnote" tone="secondary">
          {machine?.name}
          {online === null ? "" : ` · ${t(online ? "online" : "offline")}`}
        </Text>
      </View>

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

      <Section title={t("provider.heading")} footer={t("provider.agentFooter")}>
        <Row icon="key" title="Provider" value={agent.provider} />
        <Row title="model" value={agent.model} />
      </Section>
    </Screen>
  );
}
