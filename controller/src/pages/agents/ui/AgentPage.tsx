import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Keyboard, View } from "react-native";
import { APPROVAL_TIMEOUT_S_DEFAULT, APPROVAL_TIMEOUT_S_MAX, APPROVAL_TIMEOUT_S_MIN } from "@veeloe/protocol-ts";
import { allowlistOf, approvalTimeoutOf, useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { previewOf, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { formatTokens, useNow, when } from "../../../shared/lib";
import { confirm, Empty, Field, Icon, inform, Meter, Note, Row, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { providerProblem } from "../model/providers";
import { budgetOf } from "../model/budget";
import { ExpiryPicker } from "./ExpiryPicker";

// controller-prototype's AgentPage: the Agent's Tasks first, then its settings.
// ponytail: only what this version has. Description, instructions, Memory, Skill and the rest come with their changes.
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
  // What the last save sent, so the page shows the Machine's values once they land (ADR 0006).
  const [sent, setSent] = useState<{ name: string; budget?: number } | null>(null);
  const [tried, setTried] = useState(false);
  const [notSent, setNotSent] = useState(false);
  // How long an Approval waits, as the Machine last said (ADR 0030).
  const approvalSeconds = approvalTimeoutOf(agent) ?? APPROVAL_TIMEOUT_S_DEFAULT;
  const offline = online === false || !link || notSent;
  const problem = providerProblem(agent, machineStatus.providers);
  const dirty = name.trim() !== agent.name;
  // A name or Budget not being edited follows the Machine's (ADR 0006).
  const [budgetText, setBudgetText] = useState(agent.budget !== null ? String(agent.budget / 1_000_000) : "");
  // The field takes millions; what goes to the Machine is a whole number of tokens above zero.
  const { tokens: budgetTokens, valid: budgetValid } = budgetOf(budgetText);
  const budgetChanged = agent.budget === null ? budgetValid : budgetTokens !== agent.budget;
  const share = agent.budget ? Math.min(1, (agent.usage_tokens ?? 0) / agent.budget) : 0;
  // One save for the name and the Budget: the header's button. An unchanged Budget is left out, and an invalid one disables it.
  const canSave = !!name.trim() && (dirty || budgetChanged) && (!budgetChanged || budgetValid) && !offline && sent === null;

  // The values shown are the Machine's (ADR 0006), and another device's change comes in the same way.
  // A Machine older than `daily-budget` never says a Budget: its answer settles the save rather than spinning forever.
  useEffect(() => {
    if (sent !== null && agent.name === sent.name && (sent.budget === undefined || agent.budget === sent.budget || agent.budget === null)) setSent(null);
  }, [sent, agent.name, agent.budget]);
  // A name not being edited follows the Machine's.
  const [shown, setShown] = useState(agent.name);
  if (shown !== agent.name) {
    setShown(agent.name);
    if (name.trim() === shown) setName(agent.name);
  }
  const [shownBudget, setShownBudget] = useState(agent.budget);
  if (shownBudget !== agent.budget) {
    setShownBudget(agent.budget);
    if (sent === null) setBudgetText(agent.budget !== null ? String(agent.budget / 1_000_000) : "");
  }
  useEffect(() => {
    if (machineStatus.updateError) setSent(null);
  }, [machineStatus.updateError]);

  function save() {
    const next = name.trim();
    if (!next || !link || !machine || !canSave) return;
    Keyboard.dismiss();
    setTried(true);
    const budget = budgetChanged && budgetValid ? budgetTokens : undefined;
    // A Budget that did not change is not sent, so a rename alone stays a rename; both go in one envelope when both change.
    if (!link.updateAgent(machine, { id: agent.id, name: next, ...(budget !== undefined && { budget }) })) return setNotSent(true);
    setSent({ name: next, ...(budget !== undefined && { budget }) });
  }

  async function remove() {
    if (!link || !machine || offline) return inform(t("delete.failed"), t("needsOnline"));
    if (!(await confirm({ title: t("delete.title", { name: agent.name }), message: t("delete.body"), action: t("delete.action"), cancel: t("delete.cancel", { name: agent.name }), destructive: true }))) return;
    let sig: string | null = null;
    await keySession.withFreshAuthentication(t("delete.prompt", { name: agent.name }), async () => {
      sig = link.deleteAgent(machine, agent.id);
    });
    if (!sig) inform(t("delete.failed"), t("needsOnline"));
  }

  return (
    <Screen title={agent.name} right={{ label: t("save"), onPress: save, disabled: !canSave }}>
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
      </Section>

      <Section title={t("approval.heading")} footer={t("approval.footer")}>
        <ExpiryPicker
          seconds={approvalSeconds}
          disabled={offline}
          onPick={(next) => {
            if (link && machine) link.updateAgent(machine, { id: agent.id, approvalTimeoutS: next });
          }}
        />
      </Section>

      <Section title={t("more.heading")}>
        <Row icon="shield" title={t("allowlist.row")} value={t("allowlist.count", { count: (allowlistOf(agent) ?? []).length })} href={`/agents/${agent.id}/allowlist`} />
      </Section>

      <Section title={t("provider.heading")} footer={t("provider.nextTask")}>
        <Row icon="key" title={problem === "provider" ? t("problem.choose") : agent.provider} detail={agent.model} href={`/agents/${agent.id}/model`} />
      </Section>

      <Section title={t("budget.heading")} footer={t("budget.footer")}>
        {agent.budget !== null && (
          <View style={{ gap: space.sm, padding: space.sm }}>
            <Meter value={share} label={t("budget.label")} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              {share >= 0.8 && <Icon name="info" size="sm" color={share >= 1 ? "red" : "orange"} />}
              <Text variant="footnote" tone="secondary">
                {t("budget.used", { used: formatTokens(agent.usage_tokens ?? 0), budget: formatTokens(agent.budget), percent: Math.round(share * 100) })}
                {share >= 1 ? t("budget.spent") : ""}
              </Text>
            </View>
          </View>
        )}
        <Field label={t("budget.field")} value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" />
      </Section>
      {sent !== null && <Row title={t("saving")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />}
      {tried && machineStatus.updateError && sent === null && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: machineStatus.updateError })}
        </Note>
      )}
      {machineStatus.deleteError && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: machineStatus.deleteError })}
        </Note>
      )}
      <Section title={t("delete.action")} footer={t("delete.body", { name: agent.name })}>
        <Row icon="trash" title={t("delete.action")} destructive onPress={() => void remove()} />
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
