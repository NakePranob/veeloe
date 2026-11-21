import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useDevices } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { needsYou, statusOf, useTaskSummaries } from "../../../entities/task";
import { useUsageDays } from "../../../entities/usage";
import { PUSH_READY, savePushEnabled, useMachineStatuses, usePushEnabled } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { saveLanguage, useLanguage, useT } from "../../../shared/i18n";
import { formatTokens, shiftDay, type Bar } from "../../../shared/lib";
import { Bars, Dot, Screen, Section, Text, Tile, ToggleRow, type Colors } from "../../../shared/ui";

const TILE = 156;

// The Workspace board: four squares that each open a page, then this device's own setting.
export function WorkspacePage() {
  const t = useT("workspace");
  const database = useDatabase();
  const language = useLanguage();
  const machines = useMachines();
  const statuses = useMachineStatuses();
  const agents = useAgents();
  const tasks = useTaskSummaries();
  const rows = useUsageDays();
  const devices = useDevices();
  const live = devices?.filter((d) => d.revoked_at === null);
  const online = machines?.filter((m) => statuses[m.id]?.online === true).length ?? 0;

  // Each Agent counts by its latest Task, as the Inbox sorts it.
  // ponytail: needs-you mirrors the agent-inbox widget's tabOf, which its index does not export; use it once it does.
  let waiting = 0;
  let working = 0;
  for (const agent of agents ?? []) {
    const latest = tasks?.filter((task) => task.agent_id === agent.id).sort((a, b) => b.updated_at - a.updated_at)[0];
    const status = statusOf(latest, statuses[agent.machine_id]?.online ?? null);
    if (needsYou(status)) waiting++;
    else if (status === "working") working++;
  }

  // Today is the latest day a Machine gave us, as the Usage page reads it; the bars are the week up to it.
  const ids = new Set(agents?.map((agent) => agent.id));
  const kept = rows?.filter((row) => ids.has(row.agent_id)) ?? [];
  const today = kept.map((row) => row.day).sort().at(-1);
  const total = (day: string) => kept.filter((row) => row.day === day).reduce((sum, row) => sum + row.tokens, 0);
  const bars: Bar[] = today
    ? Array.from({ length: 7 }, (_, i) => {
        const day = shiftDay(today, i - 6);
        const known = kept.some((row) => row.day === day);
        return { key: day, value: total(day), known, title: t("tokens.bar", { day, tokens: formatTokens(total(day)) }) };
      })
    : [];

  const pushOn = usePushEnabled();

  const next = language === "th" ? "en" : "th";
  return (
    <Screen title="Workspace" right={{ label: language === "th" ? "TH" : "EN", variant: "chip", onPress: () => void saveLanguage(database, next) }}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Tile
            icon="machine"
            value={machines ? String(machines.length) : undefined}
            title="Machine"
            detail={machines?.length ? <Line color={online ? "green" : "tertiaryLabel"} text={t("machines.online", { online, count: machines.length })} /> : undefined}
            height={TILE}
            href="/machines"
          />
          <Tile
            icon="agent"
            value={agents ? String(agents.length) : undefined}
            title="Agent"
            detail={agents?.length ? <Line color={waiting ? "orange" : undefined} text={t("agents.line", { waiting, working })} /> : undefined}
            height={TILE}
            href="/agents"
          />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Tile
            top={<Bars bars={bars} label={t("tokens.chart")} height={40} />}
            value={rows ? formatTokens(today ? total(today) : 0) : undefined}
            title={t("tokens.title")}
            detail={t("tokens.detail")}
            height={TILE}
            href="/usage"
          />
          <Tile
            icon="device"
            value={live ? String(live.length) : undefined}
            title={t("devices.title")}
            // Once there is a device list, which comes with the first Machine.
            detail={live?.length === 1 ? <Line color="orange" text={t("devices.linkSecond")} /> : undefined}
            height={TILE}
            href="/devices"
          />
        </View>
      </View>
      {/* The board's switch, hidden while push is dormant, so it never promises a banner that will not come. */}
      {PUSH_READY && (
        <Section title={t("thisDevice")} footer={t("note")}>
          <ToggleRow title={t("push.title")} detail={t("push.detail")} value={pushOn} onChange={(on) => void savePushEnabled(database, on)} />
        </Section>
      )}
    </Screen>
  );
}

// A tile's last line: a dot that says the same thing as the words after it.
function Line({ color, text }: { color?: keyof Colors; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {color && <Dot color={color} size={7} />}
      <Text variant="caption" tone="body" numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}
