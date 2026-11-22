import { useState } from "react";
import { View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, type Mood } from "../../../entities/character";
import { TaskStatusDot, type TaskStatus } from "../../../entities/task";
import { useT } from "../../../shared/i18n";
import { DotLabel, Field, Meter, Row, Section, Tap, Text, space } from "../../../shared/ui";
import { countsOf, groupOf, SHOWN, type Group } from "../model/agents";

export type AgentLine = { agent: AgentRow; status: TaskStatus; mood: Mood; share: number | null; spent: boolean };

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
    <View style={{ gap: space.smd }}>
      {many && <Field bare icon="search" label={t("agentsTab.search")} value={query} onChangeText={setQuery} placeholder={t("agentsTab.searchPlaceholder", { count: lines.length })} />}
      <Section footer={t(many ? "agentsTab.footerMany" : "agentsTab.footer", { count: SHOWN })}>
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
          !q && <Row add title={t("agentsTab.create")} href="/agents/new" />
        )}
      </Section>
    </View>
  );
}

function GroupHeading({ group, count }: { group: Group; count: number }) {
  const t = useT("machines");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.smd, paddingHorizontal: space.inset, paddingTop: space.md, paddingBottom: space.xxs }}>
      <DotLabel color={group === "needsYou" ? "orange" : group === "working" ? "blue" : "tertiaryLabel"} tone="secondary" strong>
        {t(`agentsTab.group.${group}`)}
      </DotLabel>
      <Text variant="caption" tone="secondary">
        {String(count)}
      </Text>
    </View>
  );
}

function AgentRowView({ line, online, compact }: { line: AgentLine; online: boolean | null; compact: boolean }) {
  const t = useT("machines");
  const spent = line.spent;
  // The long list (Machine-Many) packs rows tighter with smaller heads.
  return (
    <Tap href={`/agents/${line.agent.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.md, paddingRight: space.inset, paddingVertical: compact ? space.smd : space.sm }}>
      {({ pressed }) => (
        <>
          <Character look={lookOfJson(line.agent.character)} mood={line.mood} size={compact ? 40 : 44} backdrop={pressed ? "chipPressed" : "card"} />
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text variant="subheadline" strong numberOfLines={1} tone={online === false ? "secondary" : "label"}>
              {line.agent.name}
              <Text variant="caption" mono tone="secondary">{`  ${line.agent.model}`}</Text>
            </Text>
            <TaskStatusDot status={line.status} spent={spent} />
          </View>
          {line.share !== null && (
            <View style={{ width: 52, alignItems: "flex-end", gap: space.xs }}>
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
