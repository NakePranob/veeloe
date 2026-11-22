import { useEffect, useRef } from "react";
import { View } from "react-native";
import type React from "react";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { useMachines, type Machine } from "../../../entities/machine";
import { latestEvents, previewOf, useTaskSummaries } from "../../../entities/task";
import { agentTotals, dailyTotals, useUsageDays, type UsageDayRow } from "../../../entities/usage";
import { useMachineLink, useMachineStatuses, useUsageStatuses, type UsageStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { formatTokens, shiftDay, useNow, when, type Bar } from "../../../shared/lib";
import { Bars, Button, Empty, Meter, Note, Row, Screen, Section, size, Spinner, Tap, Text, space } from "../../../shared/ui";
import { saveUsageWindow, USAGE_WINDOWS, useUsageWindow } from "../model/window";

const latestOf = (task: Parameters<typeof latestEvents>[0] | undefined) => (task ? latestEvents(task) : []);

/** The windows as words in the picked language; one key per window keeps the labels in the JSON. */
const WINDOW_KEY = { 1: "window.1", 3: "window.3", 7: "window.7", 30: "window.30" } as const;

function WindowPicker({ days }: { days: number }) {
  const t = useT("usage");
  const database = useDatabase();
  // Four equal 44pt pills across the width, as the board draws them: the chosen one ink, the rest grey.
  return (
    <View style={{ flexDirection: "row", gap: space.smd }}>
      {USAGE_WINDOWS.map((window) => (
        <View key={window} style={{ flex: 1 }}>
          <Button label={t(WINDOW_KEY[window])} variant={window === days ? "primary" : "chip"} pressed={window === days} onPress={() => void saveUsageWindow(database, window)} />
        </View>
      ))}
    </View>
  );
}

// One line of a breakdown: name and "used of limit", the meter, then where it stands.
function UsageLine({ title, used, limit, line, leading, href, dim }: { title: string; used: number; limit: number | null; line: string; leading?: React.ReactNode; href: string; dim?: boolean }) {
  const t = useT("usage");
  const language = useLanguage();
  const share = limit ? used / limit : null;
  const spent = share !== null && share >= 1;
  // Offline: nothing to open and nothing fresh to measure, so the whole line goes grey with only what it used.
  if (dim) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.row, paddingHorizontal: space.inset, paddingVertical: space.md }}>
        {leading}
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text variant="subheadline" strong tone="secondary" numberOfLines={1}>
            {title}
          </Text>
          {line ? (
            <Text variant="caption" tone="secondary">
              {line}
            </Text>
          ) : null}
        </View>
        <Text variant="footnote" tone="secondary">
          {formatTokens(used, language)}
        </Text>
      </View>
    );
  }
  return (
    <Tap href={href} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.row, paddingHorizontal: space.inset, paddingVertical: space.md }}>
      {leading}
      <View style={{ flex: 1, gap: space.smd }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
          <Text variant="subheadline" strong style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <Text variant="footnote" tone="secondary">
            {limit ? t("of", { used: formatTokens(used, language), limit: formatTokens(limit, language) }) : formatTokens(used, language)}
          </Text>
        </View>
        {share !== null && <Meter value={share} label={t("budget", { percent: Math.round(share * 100) })} />}
        {(line || share !== null) && (
          <Text variant="caption" tone={spent ? "danger" : "label"}>
            {share === null ? line : t(line ? (spent ? "lineBudgetSpent" : "lineBudget") : spent ? "budgetSpent" : "budget", { line, percent: Math.round(share * 100) })}
          </Text>
        )}
      </View>
    </Tap>
  );
}

function Overview({ machines, agents, rows, statuses, from, to }: { machines: Machine[]; agents: AgentRow[]; rows: UsageDayRow[]; statuses: Record<string, UsageStatus>; from: string | null; to: string | null }) {
  const t = useT("usage");
  const language = useLanguage();
  const ids = new Set(agents.map((agent) => agent.id));
  const totals = from && to ? dailyTotals(rows, ids, from, to) : [];
  const today = totals.at(-1)?.tokens ?? 0;
  const loading = machines.some((m) => statuses[m.id]?.loading);
  const bars: Bar[] = totals.map(({ day, tokens, known }) => ({ key: day, value: tokens, known, title: known ? t("chart.bar", { day, tokens: formatTokens(tokens, language) }) : t("chart.none", { day }) }));
  return (
    <Section footer={t("note")}>
      <View style={{ gap: space.xs, paddingTop: space.lg, paddingHorizontal: space.inset, paddingBottom: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text variant="footnote" strong tone="secondary" style={{ flex: 1 }}>
            {t("today")}
          </Text>
          {loading && <Spinner />}
        </View>
        <Text variant="figure">
          {formatTokens(today, language)}
          <Text variant="subheadline" tone="secondary">{` ${t("tokenUnit")}`}</Text>
        </Text>
        {bars.length > 0 ? (
          <View style={{ marginTop: space.sm }}>
            <Bars bars={bars} label={t("chart.label", { machine: t("all") })} height={140} ticks={bars.map((bar, i) => tickOf(bar.key, i === bars.length - 1, bars.length, language, t("chart.today")))} peak={formatTokens(today, language)} />
          </View>
        ) : (
          <Text variant="footnote" tone="secondary">
            {t("machine.none")}
          </Text>
        )}
      </View>
    </Section>
  );
}

/** The word under a day's bar: its short weekday, or "today" for the last; a month of bars names only today. */
function tickOf(day: string, last: boolean, count: number, language: string, today: string) {
  if (last) return today;
  // Noon, so a time zone never moves the Machine's day onto its neighbour.
  return count <= 7 ? new Date(`${day}T12:00:00`).toLocaleDateString(language, { weekday: "short" }) : "";
}

function TopTasks({ statuses, agents }: { statuses: Record<string, UsageStatus>; agents: AgentRow[] }) {
  const t = useT("usage");
  const language = useLanguage();
  const summaries = useTaskSummaries() ?? [];
  const previews = new Map(summaries.map((task) => [task.id, previewOf(task)]));
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  // Only an answer that is no longer loading belongs to the window on screen; a half-arrived window shows nothing.
  const fresh = Object.values(statuses).filter((status) => !status.loading && status.from !== null && status.to !== null);
  const tasks = fresh
    .flatMap((status) => status.tasks)
    .filter((task) => names.has(task.agent))
    .sort((a, b) => b.tokens - a.tokens);
  // What is left after the Machine's 20 biggest Tasks per Agent: never a row that pretends to know the names.
  const other = fresh.reduce((sum, status) => sum + Math.max(0, status.total - status.tasks.reduce((all, task) => all + task.tokens, 0)), 0);
  if (tasks.length === 0 && other === 0) return null;
  return (
    <Section title={t("tasks.heading")}>
      {tasks.slice(0, 10).map((task) => {
        const preview = previews.get(task.task);
        return (
          <Row
            key={`${task.agent}:${task.task}`}
            icon="thread"
            title={preview || t("tasks.unknown", { id: task.task.slice(0, 8) })}
            detail={names.get(task.agent)}
            value={formatTokens(task.tokens, language)}
            {...(preview ? { href: `/tasks/${task.task}?agent=${task.agent}` } : {})}
          />
        );
      })}
      {other > 0 && <Row title={t("tasks.other")} value={formatTokens(other, language)} />}
    </Section>
  );
}

export function UsagePage() {
  const t = useT("usage");
  const language = useLanguage();
  const now = useNow();
  const link = useMachineLink();
  const machines = useMachines();
  const agents = useAgents() ?? [];
  const rows = useUsageDays() ?? [];
  const statuses = useUsageStatuses();
  // Newest first, so the first Task of an Agent's is the one its face shows, as the Inbox reads it.
  const summaries = useTaskSummaries() ?? [];
  const machineStatuses = useMachineStatuses();
  const days = useUsageWindow();

  const list = machines ?? [];
  const agentIds = new Set(agents.map((agent) => agent.id));
  // Each Machine's own today, or the last day it gave us; the window ends at the latest of them.
  const to =
    [...list.map((m) => statuses[m.id]?.to ?? null), ...rows.filter((row) => agentIds.has(row.agent_id)).map((row) => row.day)]
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null;
  const from = to ? shiftDay(to, -(days - 1)) : null;
  // The rows count the chart's own days from the same history, so they add up to it (`controller-usage`).
  const used = from && to ? agentTotals(rows, from, to) : new Map<string, number>();
  const usedOf = (agent: AgentRow) => used.get(agent.id) ?? 0;
  const ids = list.map((machine) => machine.id).join(",");
  const online = list.map((machine) => `${machine.id}:${machineStatuses[machine.id]?.online}`).join(",");
  // The latest list without making the effect depend on the Machine rows, which the answer itself rewrites.
  const latest = useRef(list);
  latest.current = list;

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids and online are the triggers; the rows themselves are read through `latest`
  useEffect(() => {
    if (!link) return;
    for (const machine of latest.current) link.requestUsage(machine, days);
  }, [link, days, ids, online]);

  function retry() {
    if (!link) return;
    for (const machine of list) link.requestUsage(machine, days);
  }

  return (
    <Screen title={t("title")} right={{ label: t("retry"), onPress: retry }}>
      <WindowPicker days={days} />
      {machines === null ? (
        <View style={{ alignItems: "center", padding: space.xl }}>
          <Spinner />
        </View>
      ) : list.length === 0 ? (
        <Empty icon="usage" title={t("empty.title")} detail={t("empty.body")} />
      ) : (
        <>
          <Overview machines={list} agents={agents} rows={rows} statuses={statuses} from={from} to={to} />
          <Section title={t("byMachine")}>
            {list.map((machine) => {
              const online = machineStatuses[machine.id]?.online ?? null;
              const machineUsed = agents.filter((agent) => agent.machine_id === machine.id).reduce((sum, agent) => sum + usedOf(agent), 0);
              const fetched = machine.usage_fetched_at ? when(machine.usage_fetched_at, language, now) : null;
              const state = online === null ? null : t(online ? "machine.online" : "machine.offline");
              const line = state && fetched ? t("machine.stateFetched", { state, when: fetched }) : fetched ? t("machine.fetched", { when: fetched }) : (state ?? "");
              // What it used, never a ceiling: no Budget divides a Machine's total (`controller-usage`).
              return <UsageLine key={machine.id} title={machine.name} used={machineUsed} limit={null} line={line} href={`/machines/${machine.id}`} dim={online === false} />;
            })}
          </Section>
          {agents.length > 0 && (
            <Section title={t("byAgent")}>
              {[...agents]
                .sort((a, b) => usedOf(b) - usedOf(a))
                .map((agent) => (
                  <UsageLine
                    key={agent.id}
                    title={agent.name}
                    used={usedOf(agent)}
                    // Today's Budget only for one day the Machine just said is today; a cached day may be yesterday.
                    limit={days === 1 && to !== null && statuses[agent.machine_id]?.to === to ? agent.budget : null}
                    line={list.find((m) => m.id === agent.machine_id)?.name ?? ""}
                    leading={<Character look={lookOfJson(agent.character)} mood={moodOf(latestOf(summaries.find((task) => task.agent_id === agent.id)), machineStatuses[agent.machine_id]?.online ?? null)} size={32} />}
                    href={`/agents/${agent.id}`}
                  />
                ))}
            </Section>
          )}
          {list.map((machine) => {
            const error = statuses[machine.id]?.error;
            return error ? (
              <Note key={machine.id} icon="warning" iconColor="orange">
                {t("machineError", { machine: machine.name, error: describeError({ code: error }) })}
              </Note>
            ) : null;
          })}
        </>
      )}
      <TopTasks statuses={statuses} agents={agents} />
    </Screen>
  );
}
