import type { ListedTrigger } from "@veeloe/protocol-ts";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Card, Empty, Field, Icon, inform, Note, Screen, Section, Select, Spinner, Text, confirm, space } from "../../../shared/ui";
import { draftOf, EMPTY_DRAFT, triggerOf, type Draft, type Mode, type Problem } from "../model/schedule";

const PROBLEM = {
  empty: { title: "problem.empty.title", body: "problem.empty.body" },
  tooOften: { title: "problem.tooOften.title", body: "problem.tooOften.body" },
  badTime: { title: "problem.badTime.title", body: "problem.badTime.body" },
} as const satisfies Record<Problem, { title: string; body: string }>;

type Action = "trigger.pause" | "trigger.resume" | "trigger.run" | "trigger.delete";

const PROMPT = { "trigger.pause": "authenticate.pause", "trigger.resume": "authenticate.resume", "trigger.run": "authenticate.run", "trigger.delete": "authenticate.delete" } as const satisfies Record<Action, string>;

/** 2026-11-22 was a Sunday: the weekday names come from the device's own calendar, in its language. */
const dayName = (day: number, language: string) => new Date(2026, 10, 22 + day).toLocaleDateString(language, { weekday: "long" });

// The Agent's Schedules (issue #56), drawn like the Git page: a card per Schedule with its actions under it.
// Every change is signed after a fresh authentication (ADR 0012) and the Machine answers with the whole list.
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
  return <ScheduleView key={agent.id} agentId={agent.id} agentName={agent.name} machine={machine} />;
}

function ScheduleView({ agentId, agentName, machine }: { agentId: string; agentName: string; machine: Machine }) {
  const t = useT("agent-schedule");
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agentId);
  const offline = online === false || !link;
  // null: no editor; a string: the id being written, a new one or one being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const triggers = status.triggers ?? [];

  // Ask on open and again when the Machine comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (link && online !== false) link.requestTriggers(machine, agentId);
  }, [link, machine.id, agentId, online]);

  function open(trigger?: ListedTrigger) {
    setDraft(trigger ? draftOf(trigger) : EMPTY_DRAFT);
    setEditing(trigger?.id ?? `tr-${randomUUID()}`);
  }

  async function save() {
    if (!link || editing === null) return;
    const trigger = triggerOf(draft, editing);
    if (typeof trigger === "string") return inform(t(PROBLEM[trigger].title), t(PROBLEM[trigger].body));
    Keyboard.dismiss();
    const sent = await keySession.signed(t("authenticate.save", { name: agentName }), () => link.changeTrigger(machine, { type: "trigger.set", body: { agent: agentId, trigger } }));
    if (sent.status === "sent") setEditing(null);
  }

  async function act(type: Action, trigger: ListedTrigger) {
    if (!link) return;
    if (type === "trigger.delete" && !(await confirm({ title: t("delete.title"), message: t("delete.message", { name: agentName }), action: t("delete.action"), cancel: t("cancel"), destructive: true }))) return;
    await keySession.signed(t(PROMPT[type], { name: agentName }), () => link.changeTrigger(machine, { type, body: { agent: agentId, id: trigger.id } }));
  }

  return (
    <Screen title={t("title")} subtitle={agentName} right={{ label: t("add"), icon: "add", variant: "chip", onPress: () => open(), disabled: offline || editing !== null }}>
      <Note tone="plain">{t("note")}</Note>
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
      {editing !== null && <Editor draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setEditing(null)} saving={status.sending} disabled={offline} isNew={!triggers.some((trigger) => trigger.id === editing)} />}
      {status.triggers && triggers.length === 0 && editing === null && <Empty icon="time" title={t("empty.title")} detail={t("empty.body")} />}
      <View style={{ gap: space.md }}>
        {triggers.map((trigger) => (
          <ScheduleCard key={trigger.id} trigger={trigger} locked={offline || status.sending} onEdit={() => open(trigger)} onAct={(type) => void act(type, trigger)} />
        ))}
      </View>
    </Screen>
  );
}

function Editor({ draft, onChange, onSave, onCancel, saving, disabled, isNew }: { draft: Draft; onChange: (draft: Draft) => void; onSave: () => void; onCancel: () => void; saving: boolean; disabled: boolean; isNew: boolean }) {
  const t = useT("agent-schedule");
  const language = useLanguage();
  const set = (change: Partial<Draft>) => onChange({ ...draft, ...change });
  return (
    <Section title={isNew ? t("editor.new") : t("editor.edit")} footer={t("editor.footer")}>
      <Field label={t("editor.text")} value={draft.text} onChangeText={(text) => set({ text })} placeholder={t("editor.textPlaceholder")} multiline />
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
      {draft.mode === "weekly" && (
        <Select<string>
          label={t("editor.day")}
          value={String(draft.day)}
          cancel={t("cancel")}
          onChange={(day) => set({ day: Number(day) })}
          options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: dayName(day, language) }))}
        />
      )}
      {draft.mode === "every" ? (
        <Field label={t("editor.minutes")} value={draft.minutes} onChangeText={(minutes) => set({ minutes })} keyboardType="number-pad" footer={t("editor.minutesFooter")} />
      ) : (
        // ponytail: a typed HH:MM, not a time wheel; swap in a native time picker when one is in the build.
        <Field label={t("editor.at")} value={draft.at} onChangeText={(at) => set({ at })} placeholder="09:00" keyboardType="numbers-and-punctuation" mono />
      )}
      <View style={{ flexDirection: "row", gap: space.sm, padding: space.inset }}>
        <View style={{ flex: 1 }}>
          <Button label={saving ? t("saving") : t("save")} variant="primary" disabled={disabled || saving || !draft.text.trim()} onPress={onSave} />
        </View>
        <Button label={t("cancel")} variant="surface" onPress={onCancel} />
      </View>
    </Section>
  );
}

function ScheduleCard({ trigger, locked, onEdit, onAct }: { trigger: ListedTrigger; locked: boolean; onEdit: () => void; onAct: (type: Action) => void }) {
  const t = useT("agent-schedule");
  const language = useLanguage();
  const { every, daily, weekly } = trigger.schedule;
  const rhythm = every ? t("rhythm.every", { minutes: every.minutes }) : weekly ? t("rhythm.weekly", { day: dayName(weekly.day, language), at: weekly.at }) : t("rhythm.daily", { at: daily?.at ?? "" });
  const next = trigger.nextRunAt ? new Date(trigger.nextRunAt).toLocaleString(language, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const state = trigger.suspended ? t("state.suspended") : trigger.paused ? t("state.paused") : next ? t("state.next", { when: next }) : null;
  return (
    <Card style={{ padding: space.inset, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Icon name="time" size="md" color={trigger.suspended ? "red" : trigger.paused ? "secondaryLabel" : "label"} />
        <Text variant="subheadline" strong style={{ flex: 1 }}>
          {rhythm}
        </Text>
      </View>
      <Text variant="callout" tone="body" selectable numberOfLines={4}>
        {trigger.text}
      </Text>
      {state && (
        <Text variant="caption" tone={trigger.suspended ? "danger" : "secondary"}>
          {state}
        </Text>
      )}
      {/* A suspended Schedule can only go: its key no longer speaks for anyone. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {!trigger.suspended && <Button label={t("run")} variant="primary" size="small" disabled={locked} onPress={() => onAct("trigger.run")} />}
        {!trigger.suspended && <Button label={trigger.paused ? t("resume") : t("pause")} variant="surface" size="small" disabled={locked} onPress={() => onAct(trigger.paused ? "trigger.resume" : "trigger.pause")} />}
        {!trigger.suspended && <Button label={t("edit")} variant="surface" size="small" disabled={locked} onPress={onEdit} />}
        <Button label={t("delete.action")} variant="destructive" size="small" disabled={locked} onPress={() => onAct("trigger.delete")} />
      </View>
    </Card>
  );
}
