import { TASK_TITLE_MAX } from "@veeloe/protocol-ts";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Character, lookOfJson, moodOf, shade as darken, tint } from "../../../entities/character";
import { latestOf, statusOf, TaskStatusDot, titleOfEvents, useTaskEvents } from "../../../entities/task";
import { useMachineLink } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { formatTokens, useNow, when } from "../../../shared/lib";
import { Button, EditableTitle, Note, PartKey, PartsBar, Row, Screen, Section, space, Text } from "../../../shared/ui";
import { contextPartsOf, factsOf, type ContextPart } from "../model/details";
import { useComposer } from "../model/use-composer";
import { useTaskScreen } from "../model/use-task-screen";

// Fixed overhead in greys, the conversation in the Agent's colour: lifted, as it is, and taken darker, so parts differ in
// lightness too, even for an Agent in a pale colour. A number lifts toward white; below zero takes it toward black.
const SHADE: Record<ContextPart, "label" | "secondaryLabel" | "tertiaryLabel" | number> = { system: "label", memory: "secondaryLabel", tools: "tertiaryLabel", summary: 0.55, results: 0, agent: -0.3, you: -0.55 };
const percent = (tokens: number, window: number) => {
  const value = (tokens / window) * 100;
  return value < 0.1 ? "<0.1%" : `${value < 1 ? value.toFixed(1) : Math.round(value)}%`;
};

/**
 * The Task details sheet (board "Task: รายละเอียด"): its name to rename in place, where its context goes, and what
 * it touched. Opened by a long press on a Task row (with a way into the Task) and by tapping the Task's header.
 */
export function TaskDetailsPage() {
  const t = useT("task");
  const language = useLanguage();
  const now = useNow();
  const { task, agent: agentId, from } = useLocalSearchParams<{ task: string; agent: string; from?: string }>();
  const screen = useTaskScreen(task, agentId);
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const composer = useComposer({ task, screen, link, events: events ?? undefined });

  // The sheet is for a live Agent's Task; a deleted Agent's shows nothing.
  if (!events || !screen || screen.readOnly) return <Screen title={t("details.title")}>{null}</Screen>;
  const { agent, machine, status } = screen;
  const offline = status.online === false || !link || !machine;
  const latest = latestOf(events);
  const taskStatus = statusOf(latest, status.online);
  const named = events.some((event) => event.kind === "task.titled");
  const title = titleOfEvents(events) || t("details.untitled");
  const look = lookOfJson(agent.character);
  const context = contextPartsOf(events);
  const compactions = events.filter((event) => event.kind === "context.compacted").length;
  const facts = factsOf(events);
  const hint = offline ? t("details.hintOffline") : named ? null : t("details.hintFirst");
  const shade = (part: ContextPart) => {
    const value = SHADE[part];
    if (typeof value !== "number") return value;
    return (value < 0 ? darken(look.color, -value) : tint(look.color, value)) as `#${string}`;
  };

  return (
    <Screen title={t("details.title")}>
      <View style={{ alignItems: "center", gap: space.sm, paddingTop: space.xl * 2 }}>
        <Character look={look} mood={moodOf(events, status.online)} size={76} />
        <EditableTitle value={title} label={t("details.titleLabel", { title })} maxLength={TASK_TITLE_MAX} disabled={offline} onSave={(next) => (machine && link ? link.renameTask(machine, { agent: agent.id, task, title: next }) : null)} />
        {hint && (
          <Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
            {hint}
          </Text>
        )}
        <TaskStatusDot status={taskStatus} />
      </View>

      {offline && <Note tone="offline">{t("details.offline")}</Note>}
      {composer.busy && <Button label={composer.stopping ? t("stop.stopping") : t("details.stop")} leading="stopped" variant="primary" size="large" disabled={offline || composer.stopping} onPress={() => void composer.stop()} />}

      <Section title={t("details.context.heading")} footer={t("details.context.footer")}>
        {context && context.parts.length > 0 ? (
          <>
            <View style={{ padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.xs }}>
                <Text variant="figure">{formatTokens(context.used, language)}</Text>
                <Text variant="footnote" tone="secondary">
                  {t("details.context.of", { window: formatTokens(context.window, language), percent: percent(context.used, context.window) })}
                </Text>
              </View>
              <PartsBar
                parts={context.parts.map((p) => ({ key: p.part, value: p.tokens, color: shade(p.part) }))}
                total={context.window}
                mark={0.7}
                label={t("details.context.bar", { used: formatTokens(context.used, language), window: formatTokens(context.window, language), percent: percent(context.used, context.window) })}
              />
              <Text variant="caption" tone="secondary">
                {compactions > 0 ? t("details.context.thresholdCompacted", { count: compactions }) : t("details.context.threshold")}
              </Text>
            </View>
            {context.parts.map((p) => (
              <Row
                key={p.part}
                leading={<PartKey color={shade(p.part)} />}
                title={t(`details.parts.${p.part}.label`)}
                detail={t(`details.parts.${p.part}.hint`)}
                value={`${formatTokens(p.tokens, language)} · ${percent(p.tokens, context.window)}`}
              />
            ))}
            <Row
              leading={<PartKey color="track" />}
              title={t("details.context.free")}
              detail={t("details.context.freeHint")}
              value={`${formatTokens(Math.max(0, context.window - context.used), language)} · ${percent(Math.max(0, context.window - context.used), context.window)}`}
            />
          </>
        ) : (
          <Row title={t("details.context.none")} />
        )}
      </Section>

      <Section title={t("details.facts.heading")}>
        <Row title={t("details.facts.agent")} value={agent.name} />
        {machine && <Row title={t("details.facts.machine")} value={machine.name} />}
        {facts.started !== null && <Row title={t("details.facts.started")} value={when(facts.started, language, now)} />}
        {facts.last !== null && <Row title={t("details.facts.last")} value={when(facts.last, language, now)} />}
        <Row title={t("details.facts.turns")} value={String(facts.turns)} />
      </Section>

      <Section title={t("details.changed.heading")} footer={facts.changed.length ? t("details.changed.footer") : undefined}>
        {facts.changed.length ? facts.changed.map((path) => <Row key={path} icon="edit" title={path} mono />) : <Row title={t("details.changed.none")} />}
      </Section>

      <Section title={t("details.sent.heading")}>
        {facts.sent.length ? (
          facts.sent.map((file) => (
            <Row
              key={file.hash}
              icon="file"
              title={file.name}
              value={t("file.size", { size: Math.max(1, Math.round(file.size / 1024)) })}
              disabled={offline}
              onPress={() => (machine && link ? void link.openFile(machine, task, agent.id, file.path, file.hash, file.name) : undefined)}
            />
          ))
        ) : (
          <Row title={t("details.sent.none")} />
        )}
      </Section>

      <View style={{ gap: space.sm }}>
        {from === "agent" && <Button label={t("details.open")} variant={composer.busy ? "chip" : "primary"} size="large" onPress={() => router.replace({ pathname: "/tasks/[task]", params: { task, agent: agent.id } })} />}
        <Button label={t("details.agent")} size="large" onPress={() => router.replace({ pathname: "/agents/[agent]", params: { agent: agent.id } })} />
      </View>
    </Screen>
  );
}
