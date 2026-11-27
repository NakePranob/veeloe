import type { ListedTrigger } from "@veeloe/protocol-ts";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus, withScope } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, confirm, DotLabel, Field, HeaderAction, inform, Note, Row, Screen, Section, Select, space, Text, ToggleRow } from "../../../shared/ui";
import { draftOf, EMPTY_DRAFT, everyChoices, lastRoundOf, minuteChoices, triggerOf, type Draft, type Mode, type Problem } from "../model/schedule";
import { useLastRounds } from "../model/use-last-rounds";
import { dayName, OUTCOME, whenShort } from "./words";

const PROBLEM = {
  empty: { title: "problem.empty.title", body: "problem.empty.body" },
  tooOften: { title: "problem.tooOften.title", body: "problem.tooOften.body" },
  badTime: { title: "problem.badTime.title", body: "problem.badTime.body" },
} as const satisfies Record<Problem, { title: string; body: string }>;

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

/**
 * One Schedule in a sheet over its list (issue #56, ADR 0079): what it says and when, how its last round went,
 * what it may do without asking, and its actions. `new` writes a new one. Every change is signed after a fresh
 * authentication (ADR 0012); the Machine answers with the whole list, which this sheet reads back.
 */
export function ScheduleSheet() {
  const t = useT("agent-schedule");
  const { agent: id, trigger } = useLocalSearchParams<{ agent: string; trigger: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) return <Screen title={t("title")}>{null}</Screen>;
  return <ScheduleForm key={trigger} agentId={agent.id} agentName={agent.name} machine={machine} triggerId={trigger} />;
}

function ScheduleForm({ agentId, agentName, machine, triggerId }: { agentId: string; agentName: string; machine: Machine; triggerId: string }) {
  const t = useT("agent-schedule");
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agentId);
  const last = useLastRounds(agentId, online);
  const offline = online === false || !link;
  const isNew = triggerId === "new";
  const [id] = useState(() => (isNew ? `tr-${randomUUID()}` : triggerId));
  const held = status.triggers?.find((one) => one.id === id);
  const [draft, setDraft] = useState<Draft | null>(isNew ? EMPTY_DRAFT : null);
  // The form starts from the Schedule as the Machine holds it, once that has arrived.
  useEffect(() => {
    if (held && draft === null) setDraft(draftOf(held));
  }, [held, draft]);
  const [saving, setSaving] = useState(false);
  const set = (change: Partial<Draft>) => setDraft((was) => (was ? { ...was, ...change } : was));

  async function sign(prompt: string, change: Parameters<NonNullable<typeof link>["changeTrigger"]>[1]) {
    if (!link) return false;
    return (await keySession.signed(prompt, () => link.changeTrigger(machine, change))).status === "sent";
  }

  async function save() {
    if (!draft || saving) return;
    // The scope as the Machine holds it now, so one added from a Task meanwhile stays (ADR 0079).
    const trigger = triggerOf(draft, id, held?.allow);
    if (typeof trigger === "string") return inform(t(PROBLEM[trigger].title), t(PROBLEM[trigger].body));
    Keyboard.dismiss();
    setSaving(true);
    try {
      if (await sign(t("authenticate.save", { name: agentName }), { type: "trigger.set", body: { agent: agentId, trigger } })) router.back();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t("delete.title"), message: t("delete.message", { name: agentName }), action: t("delete.action"), cancel: t("cancel"), destructive: true }))) return;
    if (await sign(t("authenticate.delete", { name: agentName }), { type: "trigger.delete", body: { agent: agentId, id } })) router.back();
  }

  const locked = offline || status.sending || saving;
  return (
    <Screen title={isNew ? t("editor.new") : (held?.title ?? t("editor.edit"))} subtitle={agentName}>
      <HeaderAction label={t("cancel")} placement="left" onPress={() => router.back()} />
      <HeaderAction label={saving ? t("saving") : t("save")} onPress={() => void save()} disabled={locked || !draft?.text.trim()} />
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {status.error && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.error })}
        </Note>
      )}
      {held?.suspended && <Note tone="warning">{t("state.suspended")}</Note>}
      {draft && <When draft={draft} set={set} />}
      {held?.met && (
        <Note icon="done" iconColor="green">
          {t("goal.met", { reason: held.met })}
        </Note>
      )}
      {held?.note && (
        <Section title={t("goal.note")}>
          <Text variant="body" selectable style={{ padding: space.inset }}>
            {held.note}
          </Text>
        </Section>
      )}
      {held && <Rounds trigger={held} agentId={agentId} agentName={agentName} last={lastRoundOf(held, last.get(held.id))} locked={locked} sign={sign} />}
      {held && !held.suspended && <Scope trigger={held} agentId={agentId} agentName={agentName} locked={locked} sign={sign} />}
      {held && (
        <Section>
          <Row icon="trash" title={t("delete.row")} destructive disabled={locked} onPress={() => void remove()} />
        </Section>
      )}
      {!isNew && !held && status.triggers && (
        <Note icon="warning" iconColor="orange">
          {t("missing.schedule")}
        </Note>
      )}
    </Screen>
  );
}

function When({ draft, set }: { draft: Draft; set: (change: Partial<Draft>) => void }) {
  const t = useT("agent-schedule");
  const language = useLanguage();
  const [hour, minute] = [draft.at.slice(0, 2), draft.at.slice(3, 5)];
  return (
    <>
      <Section>
        <Field label={t("editor.text")} value={draft.text} onChangeText={(text) => set({ text })} placeholder={t("editor.textPlaceholder")} multiline />
      </Section>
      <Section footer={t("editor.goalFooter")}>
        <Field label={t("editor.goal")} value={draft.goal} onChangeText={(goal) => set({ goal })} placeholder={t("editor.goalPlaceholder")} multiline />
      </Section>
      <Section footer={t("editor.footer")}>
        <Select<Mode>
          label={t("editor.when")}
          value={draft.mode}
          cancel={t("cancel")}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "every", label: t("mode.every") },
            { value: "daily", label: t("mode.daily") },
            { value: "weekly", label: t("mode.weekly") },
          ]}
        />
        {draft.mode === "every" && (
          <Select<string>
            label={t("editor.minutes")}
            value={draft.minutes}
            cancel={t("cancel")}
            onChange={(minutes) => set({ minutes })}
            options={everyChoices(draft.minutes).map((minutes) => ({ value: minutes, label: t("rhythm.every", { minutes }) }))}
          />
        )}
        {draft.mode === "weekly" && (
          <Select<string>
            label={t("editor.day")}
            value={String(draft.day)}
            cancel={t("cancel")}
            onChange={(day) => set({ day: Number(day) })}
            options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: dayName(day, language) }))}
          />
        )}
        {draft.mode !== "every" && (
          <>
            <Select<string> label={t("editor.hour")} value={hour} cancel={t("cancel")} onChange={(next) => set({ at: `${next}:${minute}` })} options={HOURS.map((value) => ({ value, label: value }))} />
            <Select<string> label={t("editor.minute")} value={minute} cancel={t("cancel")} onChange={(next) => set({ at: `${hour}:${next}` })} options={minuteChoices(draft.at).map((value) => ({ value, label: value }))} />
          </>
        )}
      </Section>
    </>
  );
}

type Sign = (prompt: string, change: Parameters<NonNullable<ReturnType<typeof useMachineLink>>["changeTrigger"]>[1]) => Promise<boolean>;

function Rounds({ trigger, agentId, agentName, last, locked, sign }: { trigger: ListedTrigger; agentId: string; agentName: string; last: ReturnType<typeof lastRoundOf>; locked: boolean; sign: Sign }) {
  const t = useT("agent-schedule");
  const language = useLanguage();
  const task = last?.task;
  return (
    <Section>
      {!trigger.suspended && (
        <ToggleRow
          title={t("enabled")}
          detail={
            trigger.pausedFor === "goal"
              ? t("state.met")
              : trigger.pausedFor === "failures"
                ? t("state.pausedFailures")
                : trigger.paused
                  ? t("state.paused")
                  : trigger.nextRunAt
                    ? t("state.next", { when: whenShort(trigger.nextRunAt, language) })
                    : undefined
          }
          value={!trigger.paused}
          onChange={(on) => void sign(t(on ? "authenticate.resume" : "authenticate.pause", { name: agentName }), { type: on ? "trigger.resume" : "trigger.pause", body: { agent: agentId, id: trigger.id } })}
        />
      )}
      <Row
        title={t("last.row")}
        accessory={
          last ? (
            <DotLabel color={OUTCOME[last.outcome].dot} tone="secondary">
              {t(OUTCOME[last.outcome].words, { when: whenShort(last.at, language) })}
            </DotLabel>
          ) : undefined
        }
        value={last ? undefined : t("last.none")}
        // The Task takes the sheet's place, as the Task details sheet opens its Task.
        onPress={task ? () => router.replace({ pathname: "/tasks/[task]", params: { task, agent: agentId } }) : undefined}
      />
      {!trigger.suspended && (
        <View style={{ padding: space.inset }}>
          <Button label={t("run")} variant="primary" size="large" disabled={locked} onPress={() => void sign(t("authenticate.run", { name: agentName }), { type: "trigger.run", body: { agent: agentId, id: trigger.id } })} />
        </View>
      )}
    </Section>
  );
}

function Scope({ trigger, agentId, agentName, locked, sign }: { trigger: ListedTrigger; agentId: string; agentName: string; locked: boolean; sign: Sign }) {
  const t = useT("agent-schedule");
  const scope = trigger.allow ?? [];
  return (
    <Section title={t("scope.heading")} footer={t("scope.footer")}>
      {scope.length === 0 && <Row title={t("scope.none")} />}
      {scope.map((entry) => (
        <Row
          key={entry}
          title={entry}
          mono
          accessory={
            <Button
              label={t("scope.remove")}
              variant="destructive"
              size="small"
              disabled={locked}
              onPress={() =>
                void sign(t("authenticate.unscope", { entry, name: agentName }), {
                  type: "trigger.set",
                  body: {
                    agent: agentId,
                    trigger: withScope(
                      trigger,
                      scope.filter((other) => other !== entry),
                    ),
                  },
                })
              }
            />
          }
        />
      ))}
    </Section>
  );
}
