import { useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { previewOf, useTaskSummaries } from "../../../entities/task";
import { useUsageDays, type UsageDayRow } from "../../../entities/usage";
import { useMachineLink, useMachineStatus, useMachineStatuses, useUsageStatus, useUsageStatuses, type UsageStatus } from "../../../features/machine-link";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { formatTokens, useNow, when, type Bar } from "../../../shared/lib";
import { shiftDay } from "../../../shared/lib/days";
import { Bars, Empty, Note, radius, Row, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { daysBetween, rowsInRange, totalOf } from "../model/summary";
import { DEFAULT_USAGE_WINDOW, isUsageWindow, saveUsageWindow, USAGE_WINDOWS } from "../model/window";

type AgentRow = { id: string; name: string; machine_id: string };

/** The windows as words in the picked language; one key per window keeps the labels in the JSON. */
const WINDOW_KEY = { 1: "window.1", 3: "window.3", 7: "window.7", 30: "window.30" } as const;

function WindowPicker({ days }: { days: number }) {
  const t = useT("usage");
  const database = useDatabase();
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: space.xs, paddingHorizontal: space.sm }}>
      {USAGE_WINDOWS.map((window) => {
        const selected = window === days;
        return (
          <Pressable
            key={window}
            role="button"
            aria-pressed={selected}
            onPress={() => void saveUsageWindow(database, window)}
            style={{
              paddingHorizontal: space.md,
              paddingVertical: space.xs,
              borderRadius: radius.pill,
              borderCurve: "continuous",
              backgroundColor: selected ? colors.accent : colors.fill,
            }}
          >
            <Text variant="subheadline" style={{ color: selected ? colors.onAccent : colors.label }}>
              {t(WINDOW_KEY[window])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MachineSection({ machine, agents, rows, days }: { machine: Machine; agents: AgentRow[]; rows: UsageDayRow[]; days: number }) {
  const t = useT("usage");
  const language = useLanguage();
  const now = useNow();
  const colors = useColors();
  const status = useUsageStatus(machine.id);
  const machineStatus = useMachineStatus(machine.id);
  const ids = new Set(agents.map((agent) => agent.id));

  // The Machine's own today, or the last day it gave us when it is offline; the window always ends there.
  const latest = rows
    .filter((row) => ids.has(row.agent_id))
    .map((row) => row.day)
    .sort()
    .at(-1);
  const to = status.to ?? latest ?? null;
  const from = to ? shiftDay(to, -(days - 1)) : null;
  const visible = from && to ? rowsInRange(rows, ids, from, to) : [];
  const total = totalOf(visible);
  const perAgent = agents.map((agent) => ({ ...agent, tokens: totalOf(visible.filter((row) => row.agent_id === agent.id)) })).sort((a, b) => b.tokens - a.tokens);
  const bars: Bar[] =
    from && to
      ? daysBetween(from, to).map((day) => {
          const dayRows = visible.filter((row) => row.day === day);
          const tokens = totalOf(dayRows);
          return {
            key: day,
            value: tokens,
            known: dayRows.length > 0,
            title: dayRows.length > 0 ? t("chart.bar", { day, tokens: formatTokens(tokens) }) : t("chart.none", { day }),
          };
        })
      : [];
  const fetched = machine.usage_fetched_at ? when(machine.usage_fetched_at, language, now) : null;

  return (
    <>
      <Section title={machine.name}>
        <View style={{ gap: space.sm, padding: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text variant="headline" style={{ flex: 1 }}>
              {t("machine.total", { tokens: formatTokens(total) })}
            </Text>
            {status.loading && <ActivityIndicator size="small" color={colors.secondaryLabel} />}
          </View>
          <Text variant="footnote" tone="secondary">
            {machineStatus.online === false ? t("machine.offline") : machineStatus.online ? t("machine.online") : ""}
            {fetched ? ` · ${t("machine.fetched", { when: fetched })}` : ""}
          </Text>
          {bars.length > 0 && <Bars bars={bars} label={t("chart.label", { machine: machine.name })} />}
          {!to && (
            <Text variant="footnote" tone="secondary">
              {t("machine.none")}
            </Text>
          )}
        </View>
        {perAgent.map((agent) => (
          <Row key={agent.id} icon="agent" title={agent.name} value={formatTokens(agent.tokens)} href={`/agents/${agent.id}`} />
        ))}
      </Section>
      {status.error && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.error })}
        </Note>
      )}
    </>
  );
}

function TopTasks({ statuses, agents }: { statuses: Record<string, UsageStatus>; agents: AgentRow[] }) {
  const t = useT("usage");
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
            value={formatTokens(task.tokens)}
            {...(preview ? { href: `/tasks/${task.task}?agent=${task.agent}` } : {})}
          />
        );
      })}
      {other > 0 && <Row title={t("tasks.other")} value={formatTokens(other)} />}
    </Section>
  );
}

export function UsagePage() {
  const t = useT("usage");
  const colors = useColors();
  const link = useMachineLink();
  const machines = useMachines();
  const agents = useAgents() ?? [];
  const rows = useUsageDays() ?? [];
  const statuses = useUsageStatuses();
  const machineStatuses = useMachineStatuses();
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'usage.window'", [], ["device_setting"]);
  const savedDays = Number(saved?.[0]?.value);
  const days = isUsageWindow(savedDays) ? savedDays : DEFAULT_USAGE_WINDOW;

  const list = machines ?? [];
  const ids = list.map((machine) => machine.id).join(",");
  const online = list.map((machine) => `${machine.id}:${machineStatuses[machine.id]?.online}`).join(",");
  // The latest list without making the effect depend on the Machine rows, which the answer itself rewrites.
  const latest = useRef(list);
  latest.current = list;

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
      <Note icon="info">{t("note")}</Note>
      {machines === null ? (
        <View style={{ alignItems: "center", padding: space.xl }}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : list.length === 0 ? (
        <Empty icon="usage" title={t("empty.title")} detail={t("empty.body")} />
      ) : (
        list.map((machine) => (
          <MachineSection key={machine.id} machine={machine} agents={agents.filter((agent) => agent.machine_id === machine.id)} rows={rows} days={days} />
        ))
      )}
      <TopTasks statuses={statuses} agents={agents} />
    </Screen>
  );
}
