import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { APPROVAL_TIMEOUT_S_DEFAULT } from "@veeloe/protocol-ts";
import { allowlistOf, approvalTimeoutOf, egressOf, gitReposOf, staleUsage, useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf, Stage } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { headsOf, STATUS_DOT, statusOf, titleOf, useAgentTaskCount, useAgentTaskSummaries, useThreadHeads } from "../../../entities/task";
import { useAgentUpdate, useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession, type Signed } from "../../../shared/keystore";
import { formatTokens, mark, splitMarks, useNow, when } from "../../../shared/lib";
import { Button, Dot, DotLabel, Empty, Field, Meter, Note, Row, Screen, Section, Spinner, Text, TextLink, Tile, ToggleRow, confirm, inform, space } from "../../../shared/ui";
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
  // Only what the page shows: the newest few Tasks and how many there are, and one row per Schedule thread.
  const tasks = useAgentTaskSummaries(agent.id, SHOWN) ?? [];
  const taskCount = useAgentTaskCount(agent.id) ?? tasks.length;
  const threads = headsOf(useThreadHeads(agent.id, true) ?? [], online);
  const [name, setName] = useState(agent.name);
  // The page shows the Machine's values once a save lands (ADR 0006), and another device's change comes in the same way.
  // A Machine older than `daily-budget` never says a Budget: its answer settles the save rather than spinning forever.
  const update = useAgentUpdate<{ name: string; budget?: number }>(agent, {
    landed: (row, sent) => row.name === sent.name && (sent.budget === undefined || row.budget === sent.budget || row.budget === null),
  });
  // Set before the confirm, so a second tap cannot ask or delete twice.
  const [removing, setRemoving] = useState(false);
  // How long an Approval waits, as the Machine last said (ADR 0030).
  const approvalSeconds = approvalTimeoutOf(agent) ?? APPROVAL_TIMEOUT_S_DEFAULT;
  const offline = update.offline;
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
  // A tally from a day the Machine has moved past shows as of that day, never as today's or used up.
  const stale = staleUsage(agent, useAgents() ?? []);
  // One save for the name and the Budget: the header's button. An unchanged Budget is left out, and an invalid one disables it.
  const canSave = !!name.trim() && (dirty || budgetChanged) && (!budgetChanged || budgetValid) && !offline && !update.sending;

  // A name not being edited follows the Machine's.
  const [shown, setShown] = useState(agent.name);
  if (shown !== agent.name) {
    setShown(agent.name);
    if (name.trim() === shown) setName(agent.name);
  }
  const [shownBudget, setShownBudget] = useState(agent.budget);
  if (shownBudget !== agent.budget) {
    setShownBudget(agent.budget);
    if (!update.sending) setBudgetText(agent.budget !== null ? String(agent.budget / 1_000_000) : "");
  }
  function save() {
    const next = name.trim();
    if (!next || !canSave) return;
    Keyboard.dismiss();
    const budget = budgetChanged && budgetValid ? budgetTokens : undefined;
    // A Budget that did not change is not sent, so a rename alone stays a rename; both go in one envelope when both change.
    update.send({ name: next, ...(budget !== undefined && { budget }) });
  }

  const newTask = () => router.push({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: agent.id } });

  async function remove() {
    if (removing) return;
    if (!link || !machine || offline) return inform(t("delete.failed"), t("needsOnline"));
    setRemoving(true);
    let result: Signed<unknown>;
    try {
      if (!(await confirm({ title: t("delete.title", { name: agent.name }), message: t("delete.body"), action: t("delete.action"), cancel: t("delete.cancel", { name: agent.name }), destructive: true }))) return;
      result = await keySession.signed(t("delete.prompt", { name: agent.name }), () => link.deleteAgent(machine, agent.id));
    } finally {
      setRemoving(false);
    }
    // A cancelled unlock sent nothing and needs no alert; only a send that failed after it does.
    if (result.status === "cancelled") return;
    if (result.status === "failed") inform(t("delete.failed"), t("needsOnline"));
    else router.replace("/");
  }

  const look = lookOfJson(agent.character);
  const latest = tasks[0];
  const repos = gitReposOf(agent);

  return (
    <Screen title="" right={{ label: t("save"), onPress: save, disabled: !canSave }}>
      <Stage color={look.color} bleed gap={space.smd}>
        <View style={{ alignItems: "center", gap: space.xs }}>
          <Character look={look} mood={moodOf(latest?.latest_kind ? [{ kind: latest.latest_kind, body: latest.latest_body }] : [], online)} size={112} />
          <Text variant="largeTitle" selectable>
            {agent.name}
          </Text>
          <DotLabel color={online === null ? undefined : online ? "green" : "tertiaryLabel"}>
            {/* ponytail: the board's "เห็นล่าสุด" waits for a last-seen time on the Machine; the model stays in its place. */}
            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
              {splitMarks(online === null ? t("stage.line", { machine: mark(0), model: mark(1) }) : t("stage.withState", { state: t(online ? "online" : "offline"), machine: mark(0), model: mark(1) })).map((piece, index) =>
                piece === 0 ? (
                  machine && <TextLink key="machine" label={machine.name} mono tone="body" onPress={() => router.push(`/machines/${agent.machine_id}`)} />
                ) : piece === 1 ? (
                  <Text key="model" variant="caption" tone="body" mono numberOfLines={1} style={{ flexShrink: 1 }}>
                    {agent.model}
                  </Text>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the words between the marks of one fixed sentence, never reordered
                  <Text key={index} variant="caption" tone="body">
                    {piece}
                  </Text>
                ),
              )}
            </View>
          </DotLabel>
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
          <Text variant="footnote" strong tone="body">
            {t("away.title", { machine: machine?.name })}{" "}
          </Text>
          {t("away.body", { name: agent.name })}
        </Note>
      ) : (
        offline && <Note tone="offline">{t("needsOnline")}</Note>
      )}
      {problem && <Note tone="warning">{problem === "provider" ? t("problem.provider", { provider: agent.provider }) : t("problem.model", { provider: agent.provider, model: agent.model })}</Note>}

      {/* Every round of one Schedule, gathered (ADR 0061); its Tasks are in the list below too. */}
      {threads.length > 0 && (
        <Section title={t("threads.heading")}>
          {threads.slice(0, SHOWN).map((thread) => (
            <Row key={thread.id} icon="time" title={thread.text.split("\n")[0] || t("threads.untitled")} value={t("threads.rounds", { count: thread.rounds })} href={`/threads/${thread.id}?agent=${agent.id}`} />
          ))}
          {threads.length > SHOWN && <Row title={t("all")} value={String(threads.length)} href={`/agents/${agent.id}/all?show=threads`} />}
        </Section>
      )}

      {/* The newest few, by when they last moved; the rest are a sheet away, read a page at a time. */}
      {tasks.length > 0 && (
        <Section title={t("tasks.heading")} footer={t("tasks.footer")}>
          {tasks.map((task) => (
            <Row
              key={task.id}
              leading={<Dot color={STATUS_DOT[statusOf(task, online)]} size={9} />}
              title={titleOf(task) || t("tasks.untitled")}
              detail={task.events ? t("tasks.detail", { status: status(statusOf(task, online)), when: when(task.updated_at, language, now) }) : status(statusOf(task, online))}
              href={`/tasks/${task.id}?agent=${agent.id}`}
              onLongPress={() => router.push({ pathname: "/tasks/[task]/details", params: { task: task.id, agent: agent.id, from: "agent" } })}
            />
          ))}
          {taskCount > SHOWN && <Row title={t("all")} value={String(taskCount)} href={`/agents/${agent.id}/all?show=tasks`} />}
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
                {stale && agent.usage_day
                  ? t("budget.asOf", { when: agent.usage_day })
                  : away && machine?.usage_fetched_at
                    ? t("budget.asOf", { when: when(machine.usage_fetched_at, language, now) })
                    : t("budget.perDay", { budget: formatTokens(agent.budget, language) })}
              </Text>
            </View>
          }
          value={formatTokens(agent.usage_tokens ?? 0, language)}
          unit={t(share >= 1 && !stale ? "budget.usedSpent" : "budget.used", { percent: Math.round(share * 100) })}
          detail={stale ? undefined : <Meter value={share} label={t("budget.label")} />}
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
        {/* \`*\` in this Agent's own Egress: the whole public internet, for an Agent that does research (ADR 0029, issue #81). */}
        <ToggleRow
          icon="network"
          title={t("openNet.title")}
          detail={t(egressOf(agent).includes("*") ? "openNet.warning" : "openNet.detail")}
          value={egressOf(agent).includes("*")}
          onChange={(on) => {
            if (!link || !machine || away) return;
            const egress = egressOf(agent);
            const next = on ? [...egress, "*"] : egress.filter((domain) => domain !== "*");
            void keySession.signed(t(on ? "openNet.onPrompt" : "openNet.offPrompt", { name: agent.name }), () => (link.setEgress(machine, next, agent.id) ? "sent" : null));
          }}
        />
        <Row icon="shield" title={t("allowlist.row")} value={t("allowlist.count", { count: (allowlistOf(agent) ?? []).length })} href={`/agents/${agent.id}/allowlist`} disabled={away} />
        <Row icon="branch" title={t("git.row")} value={repos === null ? t("git.unsupported") : t("git.count", { count: repos.length })} href={`/agents/${agent.id}/git`} disabled={away} />
        <Row icon="time" title="Trigger" detail={t("trigger.detail")} href={`/agents/${agent.id}/schedule`} disabled={away} />
        {/* Not on the board, which has no way to set the Budget yet; it saves with the name. */}
        <Field label={t("budget.field")} value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" footer={t("budget.footer")} disabled={away} />
      </Section>
      {update.sending && <Row title={t("saving")} accessory={<Spinner />} />}
      {update.error && <Note tone="warning">{describeError({ code: update.error })}</Note>}
      {machineStatus.deleteError && <Note tone="warning">{describeError({ code: machineStatus.deleteError })}</Note>}
      <Section footer={away ? t("away.deleteFooter", { machine: machine?.name }) : t("delete.body")}>
        <Row icon="trash" title={t("delete.action")} destructive onPress={() => void remove()} disabled={away || removing} />
      </Section>
    </Screen>
  );
}

/** How many Tasks and Schedule threads the page shows before "See all". */
const SHOWN = 4;

export function AgentPage() {
  const t = useT("agent");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const agent = agents?.find((a) => a.id === id);
  if (!agent) {
    // Nothing until the list lands, so a slow read never flashes "missing".
    return <Screen title="Agent">{agents && <Empty icon="agent" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  // Keyed by the Agent so a draft name never carries over to another one.
  return <AgentView key={agent.id} agent={agent} />;
}
