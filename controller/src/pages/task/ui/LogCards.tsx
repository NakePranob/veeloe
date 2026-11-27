import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { dayDistance, formatTokens, when } from "../../../shared/lib";
import { Button, Card, Icon, Inset, Label, Meter, space, Text } from "../../../shared/ui";
import type { Item } from "../model/items";

export function Problem({ code }: { code: string }) {
  return (
    <Label icon="warning" iconColor="orange">
      {describeError({ code })}
    </Label>
  );
}

export function FailedCard({ code, retryAt, agentName }: { code: string; retryAt?: number; agentName: string }) {
  const t = useT("task");
  const language = useLanguage();
  return (
    <Card tone="danger" style={{ padding: space.inset, gap: space.smd }}>
      <Label icon="failed" iconColor="red" variant="subheadline" tone="label" strong>
        <Text variant="callout" tone="danger" strong>
          {t("failedTitle")}
        </Text>
      </Label>
      <Text variant="callout" tone="body">
        {describeError({ code })} {retryAt !== undefined && `${t("retryAt", { time: new Date(retryAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }) })} `}
        {t("failedBody", { name: agentName })}
      </Text>
    </Card>
  );
}

export function CompactedCard({ item }: { item: Extract<Item, { kind: "compacted" }> }) {
  const t = useT("task");
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
      <Card style={{ padding: space.inset, gap: space.smd }}>
        <Label icon="info" tone="label" strong variant="subheadline">
          {t("compacted.title", { when: when(item.at, language) })}
        </Label>
        <Text variant="callout" tone="body" numberOfLines={open ? undefined : 2} selectable>
          {item.summary}
        </Text>
        <Text variant="caption" strong style={{ textDecorationLine: "underline" }}>
          {open ? t("compacted.hide") : t("compacted.show")}
        </Text>
      </Card>
    </Pressable>
  );
}

export function FileCard({ item, onOpen }: { item: Extract<Item, { kind: "file" }>; onOpen: () => Promise<void> }) {
  const t = useT("task");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await onOpen();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "attachment.invalid");
    } finally {
      setOpening(false);
    }
  }
  return (
    <Card style={{ paddingVertical: 10, paddingRight: 10, paddingLeft: space.inset, gap: space.sm }}>
      <View aria-label={t("file.offered")} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Inset chip>
          <Icon name="file" size="md" color="link" />
        </Inset>
        <View style={{ flex: 1 }}>
          <Text variant="callout" strong numberOfLines={1}>
            {item.name}
          </Text>
          <Text variant="caption" tone="secondary">
            {t("file.size", { size: Math.max(1, Math.round(item.size / 1024)) })}
          </Text>
        </View>
        <Button label={opening ? t("file.opening") : t("file.open")} variant="primary" disabled={opening} onPress={() => void open()} />
      </View>
      {error && <Problem code={error} />}
    </Card>
  );
}

// The one failure with a way out: the Turn stopped because today's token Budget ran out (`daily-budget`).
export function BudgetCard({ machine, agent, readOnly }: { machine: string; agent: AgentRow; readOnly: boolean }) {
  const t = useT("task");
  const language = useLanguage();
  const used = agent.usage_tokens ?? 0;
  return (
    <Card tone="warning" style={{ padding: space.inset }}>
      <Label icon="info" iconColor="orange" tone="label" strong variant="subheadline">
        {t("budget.out")}
      </Label>
      <Text variant="callout" tone="body">
        {t("budget.body", { machine })}
      </Text>
      {/* How much of today's Budget went, from the Agent's usage; a deleted Agent's stand-in has none. */}
      {!!agent.budget && (
        <>
          <Meter thin value={used / agent.budget} label={t("budget.out")} />
          <Text variant="caption" tone="secondary">
            {t("budget.used", { used: formatTokens(used, language), budget: formatTokens(agent.budget, language) })}
          </Text>
        </>
      )}
      {/* A deleted Agent has no settings page, so the way to add Budget goes with it. */}
      {!readOnly && (
        <View style={{ flexDirection: "row" }}>
          <Button label={t("budget.add")} variant="primary" onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />
        </View>
      )}
    </Card>
  );
}

// The Turn a restart cut off: the files are still there, and nothing runs again on its own (ADR 0033).
export function InterruptedCard({ machine, agentName, onContinue, readOnly }: { machine: string; agentName: string; onContinue: () => void; readOnly: boolean }) {
  const t = useT("task");
  return (
    <Card style={{ padding: space.inset }}>
      <Label icon="offline" iconColor="label" tone="label" strong variant="subheadline">
        {t("interrupted.title", { machine })}
      </Label>
      <Text variant="callout" tone="body">
        {t("interrupted.body", { name: agentName })}
      </Text>
      {/* Carry on sends a message, which a deleted Agent can no longer take. */}
      {!readOnly && (
        <View style={{ flexDirection: "row" }}>
          <Button label={t("interrupted.continue")} variant="primary" onPress={onContinue} />
        </View>
      )}
    </Card>
  );
}

// Who braked, in a centred line, so the log says a person did this and why it ended. `me` is this device's
// Member: v0.1 has only the Owner, and Member names arrive with Invitations (ADR 0053).
export function StoppedLine({ member, me, at, now }: { member: string; me: string | undefined; at: number; now: number }) {
  const t = useT("task");
  const language = useLanguage();
  return (
    <Card style={{ alignSelf: "center", paddingHorizontal: space.md, paddingVertical: space.smd, borderRadius: 14 }}>
      <Label icon="stopped">{member === me ? t("stoppedByYou", { when: when(at, language, now) }) : t("stopped", { member, when: when(at, language, now) })}</Label>
    </Card>
  );
}

// The boards' centred time line between groups far apart: today and yesterday by name, else the date.
export function Separator({ at, now }: { at: number; now: number }) {
  const t = useT("task");
  const language = useLanguage();
  const date = new Date(at);
  const time = date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const days = dayDistance(at, now);
  const words = days === 0 ? t("separator.today", { time }) : days === 1 ? t("separator.yesterday", { time }) : t("separator.date", { date: date.toLocaleDateString(language, { day: "numeric", month: "short" }), time });
  return (
    <Text variant="caption" tone="secondary" style={{ alignSelf: "center" }}>
      {words}
    </Text>
  );
}

/**
 * What a round nobody watched did not do (ADR 0079), and, for a command its Schedule still does not cover,
 * the way to let the next rounds do it. A domain goes in the Agent's Egress, not in a Schedule.
 */
export function SkippedCard({ item, entries, canScope, onScope }: { item: Extract<Item, { kind: "skipped" }>; entries: readonly string[] | null; canScope: boolean; onScope: () => Promise<boolean> }) {
  const t = useT("task");
  const [busy, setBusy] = useState(false);
  async function scope() {
    if (busy) return;
    setBusy(true);
    try {
      await onScope();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ padding: space.inset, gap: space.smd }}>
      <Label icon="approval" iconColor="orange" variant="subheadline" tone="label" strong>
        {t(item.domain ? "skipped.domainTitle" : "skipped.title")}
      </Label>
      <Inset chip>
        <Text variant="callout" mono selectable>
          {item.target}
        </Text>
      </Inset>
      <Text variant="footnote" tone="secondary">
        {item.domain ? t("skipped.domainBody") : entries?.length === 0 ? t("skipped.covered") : t("skipped.body")}
      </Text>
      {!item.domain && entries && entries.length > 0 && <Button label={t("skipped.allow")} variant="primary" size="small" disabled={!canScope || busy} onPress={() => void scope()} />}
    </Card>
  );
}
