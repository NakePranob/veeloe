import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Field, HeaderAction, inform, Note, Row, Screen, Section, Select, ToggleRow, space } from "../../../shared/ui";
import { draftOf, ITEM_CHOICES, listOf, QUIET_CHOICES, type Draft } from "../model/idle";

const newId = () => `i-${randomUUID().slice(0, 8)}`;

/**
 * The Idle Work list in a sheet over its page (ADR 0056): its pieces, their order, and its two times. With
 * `draft`, what the Agent proposed is added after the list, for the Member to read and change before signing.
 * Saving signs the whole list after a fresh authentication (ADR 0012).
 */
export function IdleWorkSheet() {
  const t = useT("agent-idle-work");
  const { agent: id, draft } = useLocalSearchParams<{ agent: string; draft?: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) return <Screen title={t("title")}>{null}</Screen>;
  return <Editor agentId={agent.id} agentName={agent.name} machine={machine} withDraft={draft === "1"} />;
}

function Editor({ agentId, agentName, machine, withDraft }: { agentId: string; agentName: string; machine: Machine; withDraft: boolean }) {
  const t = useT("agent-idle-work");
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agentId);
  const offline = online === false || !link;
  const list = status.triggers?.find((trigger) => trigger.kind === "idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  // The form starts from the list and draft as the Machine holds them, once they have arrived.
  useEffect(() => {
    if (draft === null && status.triggers) setDraft(draftOf(list, withDraft ? (status.draft ?? []) : [], newId));
  }, [draft, status.triggers, status.draft, list, withDraft]);
  const [saving, setSaving] = useState(false);
  // ponytail: the iOS toolbar keeps the first onPress it was given, so save reads the draft through a ref.
  const latest = useRef(draft);
  latest.current = draft;
  const set = (change: Partial<Draft>) => setDraft((was) => (was ? { ...was, ...change } : was));
  const setItem = (index: number, change: Partial<Draft["items"][number]>) => setDraft((was) => (was ? { ...was, items: was.items.map((item, i) => (i === index ? { ...item, ...change } : item)) } : was));

  async function save() {
    const draft = latest.current;
    if (!draft || !link || saving) return;
    const trigger = listOf(draft, list?.id ?? "idle", list?.allow);
    if (typeof trigger === "string") return inform(t(`problem.${trigger}.title`), t(`problem.${trigger}.body`));
    Keyboard.dismiss();
    setSaving(true);
    try {
      const sent = await keySession.signed(t("authenticate.save", { name: agentName }), () => link.changeTrigger(machine, { type: "trigger.set", body: { agent: agentId, trigger } }));
      if (sent.status === "sent") router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title={list ? t("edit") : t("create")} subtitle={agentName}>
      <HeaderAction label={t("cancel")} placement="left" onPress={() => router.back()} />
      <HeaderAction label={saving ? t("saving") : t("save")} onPress={() => void save()} disabled={offline || saving || !draft} />
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {draft && (
        <>
          <Section title={t("pieces.heading")} footer={t("editor.piecesFooter")}>
            {draft.items.map((item, index) => (
              <View key={item.id} style={{ gap: space.xs, paddingBottom: space.sm }}>
                <Field label={t("editor.piece", { n: index + 1 })} value={item.text} onChangeText={(text) => setItem(index, { text })} placeholder={t("editor.placeholder")} multiline />
                <ToggleRow title={t("editor.repeat")} value={item.repeat} onChange={(repeat) => setItem(index, { repeat })} />
                <View style={{ paddingHorizontal: space.inset }}>
                  <Button label={t("editor.remove")} variant="destructive" size="small" onPress={() => set({ items: draft.items.filter((_, i) => i !== index) })} />
                </View>
              </View>
            ))}
            <Row add title={t("editor.add")} onPress={() => set({ items: [...draft.items, { id: newId(), text: "", repeat: false }] })} />
          </Section>
          <Section footer={t("editor.timesFooter")}>
            <Select<"ordered" | "oldest-first">
              label={t("editor.order")}
              value={draft.order}
              cancel={t("cancel")}
              onChange={(order) => set({ order })}
              options={[
                { value: "ordered", label: t("order.ordered") },
                { value: "oldest-first", label: t("order.oldestFirst") },
              ]}
            />
            <Select<string>
              label={t("editor.quiet")}
              value={String(draft.quietMinutes)}
              cancel={t("cancel")}
              onChange={(minutes) => set({ quietMinutes: Number(minutes) })}
              options={[...new Set([...QUIET_CHOICES, draft.quietMinutes])].sort((a, b) => a - b).map((minutes) => ({ value: String(minutes), label: t("minutes", { count: minutes }) }))}
            />
            <Select<string>
              label={t("editor.item")}
              value={String(draft.itemMinutes)}
              cancel={t("cancel")}
              onChange={(minutes) => set({ itemMinutes: Number(minutes) })}
              options={[...new Set([...ITEM_CHOICES, draft.itemMinutes])].sort((a, b) => a - b).map((minutes) => ({ value: String(minutes), label: t("minutes", { count: minutes }) }))}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}
