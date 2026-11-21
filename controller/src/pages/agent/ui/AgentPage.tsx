import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { APPROVAL_TIMEOUT_S_DEFAULT, APPROVAL_TIMEOUT_S_MAX, APPROVAL_TIMEOUT_S_MIN } from "@veeloe/protocol-ts";
import { allowlistOf, approvalTimeoutOf, gitReposOf, useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf, Stage } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { previewOf, STATUS_DOT, statusOf, useTaskSummaries } from "../../../entities/task";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { formatTokens, useNow, when } from "../../../shared/lib";
import { Button, Dot, Empty, Field, Meter, Note, Row, Screen, Section, Spinner, Text, Tile, confirm, inform, space } from "../../../shared/ui";
import { providerProblem } from "../../../widgets/provider-models";
import { budgetOf } from "../model/budget";
import { ExpiryPicker } from "./ExpiryPicker";


// The Agent board: a stage in the Agent's colour with its head, name and two actions, then its Tasks,
// today's Budget and its settings. The header keeps the save for the name and the Budget, where the board
// draws a pencil to the Character (the Character row and the stage still open it).
// ponytail: only what this version has. Description, instructions, Skill and the rest come with their changes.
function AgentView({ agent }: { agent: AgentRow }) {
  const t = useT("agent");
  const status = useT("task-status");
  const language = useLanguage();
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
  // The Agent-Offline board: its Machine is away, so nothing runs and nothing about the Agent can change (ADR 0006).
  // Its Tasks still open to read, and a new Task's first message waits for the Machine.
  const away = online === false;
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

  const newTask = () => router.push({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: agent.id } });

  async function remove() {
    if (!link || !machine || offline) return inform(t("delete.failed"), t("needsOnline"));
    if (!(await confirm({ title: t("delete.title", { name: agent.name }), message: t("delete.body"), action: t("delete.action"), cancel: t("delete.cancel", { name: agent.name }), destructive: true }))) return;
    let sig: string | null = null;
    await keySession.withFreshAuthentication(t("delete.prompt", { name: agent.name }), async () => {
      sig = link.deleteAgent(machine, agent.id);
    });
    if (!sig) inform(t("delete.failed"), t("needsOnline"));
    else router.replace("/");
  }

  const look = lookOfJson(agent.character);
  const latest = tasks[0];
  const repos = gitReposOf(agent);

  return (
    <Screen title="" right={{ label: t("save"), onPress: save, disabled: !canSave }}>
      <Stage color={look.color} bleed gap={6}>
        <View style={{ alignItems: "center", gap: space.xs }}>
          <Character look={look} mood={moodOf(latest?.latest_kind ? [{ kind: latest.latest_kind, body: latest.latest_body }] : [], online)} size={112} />
          <Text variant="largeTitle" selectable>
            {agent.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {online !== null && <Dot color={online ? "green" : "tertiaryLabel"} size={7} />}
            <Text variant="caption" tone="body" numberOfLines={1} style={{ flexShrink: 1 }}>
              {/* ponytail: the board's "เห็นล่าสุด" waits for a last-seen time on the Machine; the model stays in its place. */}
              {online === null ? "" : `${t(online ? "online" : "offline")} · `}
              <Text variant="caption" tone="body" mono role="link" onPress={() => router.push(`/machines/${agent.machine_id}`)} style={{ textDecorationLine: "underline" }}>
                {machine?.name}
              </Text>
              {" · "}
              <Text variant="caption" tone="body" mono>
                {agent.model}
              </Text>
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignSelf: "stretch", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t("tasks.new")} leading="add" variant="primary" size="large" onPress={newTask} />
          </View>
          {/* Memory is read from the Machine, so it waits for it too. */}
          <Button label="Memory" leading="memory" variant="surface" size="large" disabled={away} onPress={() => router.push(`/agents/${agent.id}/memory`)} />
        </View>
      </Stage>
      {away ? (
        <Note tone="warning">
          <Text variant="footnote" strong tone="body">{t("away.title", { machine: machine?.name })} </Text>
          {t("away.body", { name: agent.name })}
        </Note>
      ) : (
        offline && (
          <Note icon="offline" iconColor="orange">
            {t("needsOnline")}
          </Note>
        )
      )}
      {problem && <Note tone="warning">{problem === "provider" ? t("problem.provider", { provider: agent.provider }) : t("problem.model", { provider: agent.provider, model: agent.model })}</Note>}

      {/* ponytail: every Task of this Agent shows; a "see all" page comes when lists get long. */}
      {tasks.length > 0 && (
        <Section title={t("tasks.heading")} footer={t("tasks.footer")}>
          {tasks.map((task) => (
            <Row
              key={task.id}
              leading={<Dot color={STATUS_DOT[statusOf(task, online)]} size={9} />}
              title={previewOf(task) || t("tasks.untitled")}
              detail={task.events ? `${status(statusOf(task, online))} · ${when(task.updated_at, language, now)}` : status(statusOf(task, online))}
              href={`/tasks/${task.id}?agent=${agent.id}`}
            />
          ))}
        </Section>
      )}

      {agent.budget !== null && (
        <Tile
          href="/usage"
          top={
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              <Text variant="footnote" strong tone="secondary" style={{ flex: 1 }}>
                {t("budget.label")}
              </Text>
              <Text variant="caption" tone="body">
                {away && machine?.usage_fetched_at ? t("budget.asOf", { when: when(machine.usage_fetched_at, language, now) }) : t("budget.perDay", { budget: formatTokens(agent.budget) })}
              </Text>
            </View>
          }
          value={formatTokens(agent.usage_tokens ?? 0)}
          unit={`${t("budget.used", { percent: Math.round(share * 100) })}${share >= 1 ? t("budget.spent") : ""}`}
          detail={<Meter value={share} label={t("budget.label")} />}
        />
      )}

      <Section title={t("identity")}>
        <Row icon="character" title="Character" detail={t("character.detail")} href={`/agents/${agent.id}/character`} disabled={away} />
        <Row icon="memory" title="Memory" detail={t("memory.detail")} href={`/agents/${agent.id}/memory`} disabled={away} />
        <Field label={t("name")} value={name} onChangeText={setName} disabled={away} />
      </Section>

      <Section title={t("work.heading")} footer={away ? t("away.workFooter", { machine: machine?.name }) : t("work.footer")}>
        <Row icon="key" title={t("provider.heading")} detail={problem === "provider" ? t("problem.choose") : undefined} value={problem === "provider" ? undefined : agent.model} href={`/agents/${agent.id}/model`} disabled={away} />
        <ExpiryPicker
          seconds={approvalSeconds}
          disabled={offline}
          onPick={(next) => {
            if (link && machine) link.updateAgent(machine, { id: agent.id, approvalTimeoutS: next });
          }}
        />
        <Row icon="shield" title={t("allowlist.row")} value={t("allowlist.count", { count: (allowlistOf(agent) ?? []).length })} href={`/agents/${agent.id}/allowlist`} disabled={away} />
        <Row icon="branch" title={t("git.row")} value={repos === null ? t("git.unsupported") : t("git.count", { count: repos.length })} href={`/agents/${agent.id}/git`} disabled={away} />
        {/* Not on the board, which has no way to set the Budget yet; it saves with the name. */}
        <Field label={t("budget.field")} value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" footer={t("budget.footer")} disabled={away} />
      </Section>
      {sent !== null && <Row title={t("saving")} accessory={<Spinner />} />}
      {tried && machineStatus.updateError && sent === null && <Note tone="warning">{describeError({ code: machineStatus.updateError })}</Note>}
      {machineStatus.deleteError && <Note tone="warning">{describeError({ code: machineStatus.deleteError })}</Note>}
      <Section footer={away ? t("away.deleteFooter", { machine: machine?.name }) : t("delete.body")}>
        <Row icon="trash" title={t("delete.action")} destructive onPress={() => void remove()} disabled={away} />
      </Section>
    </Screen>
  );
}

export function AgentPage() {
  const t = useT("agent");
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
