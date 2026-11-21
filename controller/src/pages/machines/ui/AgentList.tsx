import { useState } from "react";
import { View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, type Mood } from "../../../entities/character";
import { needsYou, STATUS_DOT, type TaskStatus } from "../../../entities/task";
import { useT } from "../../../shared/i18n";
import { Button, Dot, Field, Meter, Note, Row, Section, Tap, Text, space } from "../../../shared/ui";
import { countsOf, groupOf, SHOWN, type Group } from "../model/agents";

export type AgentLine = { agent: AgentRow; status: TaskStatus; mood: Mood; share: number | null };

// The Machine board's Agent tab: one row per Agent with its state and today's Budget. Past
// SHOWN Agents (Machine-Many) it shows a search box, the first ones by group, and "see all".
export function AgentList({ lines, online }: { lines: AgentLine[]; online: boolean | null }) {
  const t = useT("machines");
  const [query, setQuery] = useState("");
  const many = lines.length > SHOWN;
  const q = query.trim().toLowerCase();
  const found = q ? lines.filter((line) => line.agent.name.toLowerCase().includes(q) || line.agent.model.toLowerCase().includes(q)) : lines;
  const shown = many && !q ? found.slice(0, SHOWN) : found;
  const total = countsOf(lines);
  const rest = countsOf(lines.slice(SHOWN));

  return (
    <View style={{ gap: 6 }}>
      {many && <Field bare icon="search" label={t("agentsTab.search")} value={query} onChangeText={setQuery} placeholder={t("agentsTab.searchPlaceholder", { count: lines.length })} />}
      <Section>
        {shown.map((line, i) => {
          const group = groupOf(line.status);
          // Groups are headed only in the long list, where the order alone would not say why.
          const heading = many && !q && (i === 0 || groupOf(shown[i - 1]!.status) !== group);
          return (
            <View key={line.agent.id}>
              {heading && <GroupHeading group={group} count={total[group]} />}
              <AgentRowView line={line} online={online} compact={many} />
            </View>
          );
        })}
        {q && found.length === 0 && <Row title={t("agentsTab.noMatch")} />}
        {lines.length === 0 && <Row title={t("noAgent")} />}
        {many && !q ? (
          <Row title={t("agentsTab.seeAll", { count: lines.length })} detail={t("agentsTab.seeAllDetail", { count: lines.length - SHOWN, working: rest.working, idle: rest.idle + rest.needsYou })} href="/agents" />
        ) : (
          !q && <AddRow label={t("agentsTab.create")} href="/agents/new" />
        )}
      </Section>
      <Note tone="plain">{t(many ? "agentsTab.footerMany" : "agentsTab.footer", { count: SHOWN })}</Note>
    </View>
  );
}

function GroupHeading({ group, count }: { group: Group; count: number }) {
  const t = useT("machines");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 }}>
      <Dot color={group === "needsYou" ? "orange" : group === "working" ? "blue" : "tertiaryLabel"} size={7} />
      <Text variant="caption" strong tone="secondary">
        {t(`agentsTab.group.${group}`)}
      </Text>
      <Text variant="caption" tone="secondary">
        {String(count)}
      </Text>
    </View>
  );
}

function AgentRowView({ line, online, compact }: { line: AgentLine; online: boolean | null; compact: boolean }) {
  const t = useT("machines");
  const words = useT("task-status");
  const spent = line.share !== null && line.share >= 1;
  const waiting = needsYou(line.status);
  // The long list (Machine-Many) packs rows tighter with smaller heads.
  return (
    <Tap href={`/agents/${line.agent.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 10, paddingRight: 14, paddingVertical: compact ? 6 : space.sm }}>
      {({ pressed }) => (
        <>
          <Character look={lookOfJson(line.agent.character)} mood={line.mood} size={compact ? 40 : 44} backdrop={pressed ? "chipPressed" : "card"} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheadline" strong numberOfLines={1} tone={online === false ? "secondary" : "label"}>
              {line.agent.name}
              <Text variant="caption" mono tone="secondary">{`  ${line.agent.model}`}</Text>
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Dot color={spent ? "red" : STATUS_DOT[line.status]} size={7} />
              <Text variant="caption" strong={spent || waiting} tone={spent ? "danger" : waiting ? "label" : "body"} numberOfLines={1}>
                {spent ? t("agentsTab.spent") : words(line.status)}
              </Text>
            </View>
          </View>
          {line.share !== null && (
            <View style={{ width: 52, alignItems: "flex-end", gap: 4 }}>
              <Text variant="caption" strong tone={spent ? "danger" : "body"} style={{ fontVariant: ["tabular-nums"] }}>{`${Math.round(line.share * 100)}%`}</Text>
              <View style={{ width: 44 }}>
                <Meter thin value={line.share} label={t("status.budget")} />
              </View>
            </View>
          )}
        </>
      )}
    </Tap>
  );
}

// The board's create row: an ink circle with a white plus, then the action in bold.
// ponytail: local to this slice; move to shared/ui's Row if a third screen draws it.
export function AddRow({ label, href, onPress }: { label: string; href?: string; onPress?: () => void }) {
  return (
    <Tap href={href} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 }}>
      {/* The small primary Button is the board's 32pt ink circle; the row takes the press, so it is drawn only. */}
      <View aria-hidden pointerEvents="none">
        <Button variant="primary" size="small" icon="add" label={label} onPress={() => {}} />
      </View>
      <Text variant="subheadline" strong>
        {label}
      </Text>
    </Tap>
  );
}
