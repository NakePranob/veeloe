import type { ListedTrigger } from "@veeloe/protocol-ts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, confirm, Dot, Empty, Note, Row, Screen, Section, Select, Spinner, Text, ToggleRow, type Colors, space } from "../../../shared/ui";
import { piecesOf, SHARE_CHOICES } from "../model/idle";

/** How each piece reads, and the colour of its dot: orange is a person's turn, red did not finish. */
const STATUS = {
  pending: { words: "status.pending", dot: "tertiaryLabel" },
  working: { words: "status.working", dot: "accent" },
  done: { words: "status.done", dot: "green" },
  timedOut: { words: "status.timedOut", dot: "red" },
  needsApproval: { words: "status.needsApproval", dot: "orange" },
} as const satisfies Record<string, { words: string; dot: keyof Colors }>;

// An Agent's Idle Work list (ADR 0056, issue #57), drawn like the Schedule page: the pieces as rows with a dot for
// where each stands, what the Agent proposed above them, and the list's own settings under them. It is changed in a sheet.
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
  const edit = (withDraft: boolean) => router.push({ pathname: "/agents/[agent]/idle/edit", params: { agent: agent.id, ...(withDraft && { draft: "1" }) } });

  // Ask on open and again when the Machine comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (link && online !== false) link.requestTriggers(machine, agent.id);
  }, [link, machine.id, agent.id, online]);

  async function act(type: "trigger.pause" | "trigger.resume" | "trigger.run" | "trigger.delete", trigger: ListedTrigger) {
    if (!link) return;
    if (type === "trigger.delete" && !(await confirm({ title: t("delete.title"), message: t("delete.message", { name: agent.name }), action: t("delete.action"), cancel: t("cancel"), destructive: true }))) return;
    await keySession.signed(t(`authenticate.${type.slice(8) as "pause" | "resume" | "run" | "delete"}`, { name: agent.name }), () => link.changeTrigger(machine, { type, body: { agent: agent.id, id: trigger.id } }));
  }

  async function share(percent: string) {
    if (!link) return;
    await keySession.signed(t("authenticate.share", { name: agent.name, percent }), () => link.updateAgent(machine, { id: agent.id, backgroundShare: Number(percent) }));
  }

  const locked = offline || status.sending;
  return (
    <Screen title={t("title")} subtitle={agent.name} right={{ label: list ? t("edit") : t("create"), icon: list ? "edit" : "add", variant: "chip", onPress: () => edit(false), disabled: offline }}>
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
            <Row key={text} icon="agent" title={text} />
          ))}
          <Row add title={t("draft.add")} disabled={offline} onPress={() => edit(true)} />
        </Section>
      )}
      {status.triggers && !list && draft.length === 0 && (
        <Empty icon="refresh" title={t("empty.title")} detail={t("empty.body")} action={<Button label={t("create")} variant="primary" leading="add" disabled={offline} onPress={() => edit(false)} />} />
      )}
      {list && <Pieces list={list} agentId={agent.id} language={language} />}
      {list && (
        <Section footer={t("settings.footer", { quiet: list.idle?.quietMinutes ?? 15, item: list.idle?.itemMinutes ?? 15 })}>
          <ToggleRow title={t("enabled")} value={!list.paused && !list.suspended} onChange={(on) => void act(on ? "trigger.resume" : "trigger.pause", list)} />
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
          <Row icon="trash" title={t("delete.row")} destructive disabled={locked} onPress={() => void act("trigger.delete", list)} />
        </Section>
      )}
    </Screen>
  );
}

function Pieces({ list, agentId, language }: { list: ListedTrigger; agentId: string; language: string }) {
  const t = useT("agent-idle-work");
  const pieces = piecesOf(list);
  const when = (at: number) => new Date(at).toLocaleString(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Section title={t("pieces.heading")} footer={list.idle?.order === "oldest-first" ? t("pieces.oldestFirst") : t("pieces.ordered")}>
      {pieces.length === 0 && <Row title={t("pieces.allDone")} />}
      {pieces.map((piece) => {
        const task = piece.task;
        const words = t(STATUS[piece.status].words);
        return (
          <Row
            key={piece.id}
            leading={<Dot color={STATUS[piece.status].dot} />}
            title={piece.text}
            detail={[words, piece.lastRunAt ? when(piece.lastRunAt) : null, piece.repeat ? t("pieces.repeat") : null].filter(Boolean).join(" · ")}
            onPress={task ? () => router.push({ pathname: "/tasks/[task]", params: { task, agent: agentId } }) : undefined}
          />
        );
      })}
    </Section>
  );
}
