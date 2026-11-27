import type { ListedTrigger } from "@veeloe/protocol-ts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, confirm, Empty, Note, Row, Screen, Section, Select, Spinner, Text, ToggleRow, space } from "../../../shared/ui";
import { piecesOf, QUIET_CHOICES, settingsOf, SHARE_CHOICES, withPiece, type Settings } from "../model/idle";
import { Pieces } from "./pieces";
import { deleteList, signList } from "./sign";

// An Agent's Idle Work list (ADR 0056, issue #57), drawn like the Schedule page: each piece a row with a dot for where it
// stands that opens its own sheet, what the Agent proposed above them, and the list's own settings under them.
export function IdleWorkPage() {
  const t = useT("agent-idle-work");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const machines = useMachines();
  const agent = agents?.find((a) => a.id === id);
  const machine = machines?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return <Screen title={t("title")}>{agents && machines && <Empty icon="refresh" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  return <IdleWork key={agent.id} agent={agent} machine={machine} />;
}

function IdleWork({ agent, machine }: { agent: AgentRow; machine: Machine }) {
  const t = useT("agent-idle-work");
  const language = useLanguage();
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agent.id);
  const offline = online === false || !link;
  const list = status.triggers?.find((trigger) => trigger.kind === "idle");
  const draft = status.draft ?? [];
  const open = (piece: string) => router.push({ pathname: "/agents/[agent]/idle/[piece]", params: { agent: agent.id, piece } });
  const where = link && { link, machine, agentId: agent.id, agentName: agent.name, t };

  // Ask on open and again when the Machine comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (link && online !== false) link.requestTriggers(machine, agent.id);
  }, [link, machine.id, agent.id, online]);

  async function act(type: "trigger.pause" | "trigger.resume" | "trigger.run", trigger: ListedTrigger) {
    if (!link) return;
    await keySession.signed(t(`authenticate.${type.slice(8) as "pause" | "resume" | "run"}`, { name: agent.name }), () => link.changeTrigger(machine, { type, body: { agent: agent.id, id: trigger.id } }));
  }

  async function remove(trigger: ListedTrigger) {
    if (!where || !(await confirm({ title: t("delete.title"), message: t("delete.message", { name: agent.name }), action: t("delete.action"), cancel: t("cancel"), destructive: true }))) return;
    await deleteList(where, trigger);
  }

  // A setting is the whole list signed again with that one setting changed.
  const setting = (trigger: ListedTrigger, change: Partial<Settings>) => where && void signList(where, trigger, piecesOf(trigger), { ...settingsOf(trigger), ...change });

  // A drop signs the list with the piece in its new place.
  async function move(piece: string, to: number) {
    const now = piecesOf(list);
    const held = now.find((one) => one.id === piece);
    if (!where || !list || !held) return false;
    return signList(where, list, withPiece(now, held, to), settingsOf(list));
  }

  async function share(percent: string) {
    if (!link) return;
    await keySession.signed(t("authenticate.share", { name: agent.name, percent }), () => link.updateAgent(machine, { id: agent.id, backgroundShare: Number(percent) }));
  }

  const locked = offline || status.sending;
  const [dragging, setDragging] = useState(false);
  const minutes = (choices: readonly number[], held: number) => [...new Set([...choices, held])].sort((x, y) => x - y).map((count) => ({ value: String(count), label: t("minutes", { count }) }));
  return (
    <Screen title={t("title")} subtitle={agent.name} scrollEnabled={!dragging} right={{ label: t("add"), icon: "add", variant: "chip", onPress: () => open("new"), disabled: offline }}>
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
      {draft.length > 0 && (
        <Section title={t("draft.heading")} footer={t("draft.footer")}>
          {draft.map((text) => (
            <Row key={text} icon="agent" title={text} disabled={offline} onPress={() => open("draft")} />
          ))}
        </Section>
      )}
      {status.triggers && !list && draft.length === 0 && (
        <Empty icon="refresh" title={t("empty.title")} detail={t("empty.body")} action={<Button label={t("add")} variant="primary" leading="add" disabled={offline} onPress={() => open("new")} />} />
      )}
      {list && <Pieces list={list} language={language} open={open} move={move} locked={locked} onDragging={setDragging} />}
      {list && (
        <Section footer={t("settings.footer")}>
          <ToggleRow title={t("enabled")} value={!list.paused && !list.suspended} onChange={(on) => void act(on ? "trigger.resume" : "trigger.pause", list)} />
          <Select<string>
            label={t("settings.quiet")}
            value={String(settingsOf(list).quietMinutes)}
            cancel={t("cancel")}
            disabled={locked}
            onChange={(m) => setting(list, { quietMinutes: Number(m) })}
            options={minutes(QUIET_CHOICES, settingsOf(list).quietMinutes)}
          />
          <Select<string>
            label={t("share.label")}
            value={String(agent.background_share ?? 30)}
            cancel={t("cancel")}
            disabled={locked}
            onChange={(percent) => void share(percent)}
            options={SHARE_CHOICES.map((percent) => ({ value: String(percent), label: t("share.value", { percent }) }))}
          />
          <View style={{ padding: space.inset }}>
            <Button label={t("run")} variant="primary" size="large" disabled={locked || list.suspended} onPress={() => void act("trigger.run", list)} />
          </View>
        </Section>
      )}
      {list && (
        <Section>
          <Row icon="trash" title={t("delete.row")} destructive disabled={locked} onPress={() => void remove(list)} />
        </Section>
      )}
    </Screen>
  );
}
