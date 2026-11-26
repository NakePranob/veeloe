import { router, useLocalSearchParams } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { hideThread, STATUS_DOT, threadsOf, useHiddenThreads, useTaskSummaries } from "../../../entities/task";
import { useMachineStatus } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { useLanguage, useT } from "../../../shared/i18n";
import { confirm, Dot, Empty, Note, Row, Screen, Section } from "../../../shared/ui";

/**
 * Every round of one Trigger, newest first (ADR 0061): a row per Task with when it was due, its name,
 * and whether it had anything to say. Only an index: deleting it leaves every Task where it is.
 */
export function ThreadPage() {
  const t = useT("trigger-thread");
  const language = useLanguage();
  const database = useDatabase();
  const { trigger, agent: agentId } = useLocalSearchParams<{ trigger: string; agent: string }>();
  const agent = useAgents()?.find((row) => row.id === agentId);
  const summaries = useTaskSummaries();
  const hidden = useHiddenThreads();
  const online = useMachineStatus(agent?.machine_id ?? "").online;
  const thread = summaries && hidden ? threadsOf(summaries, agentId, new Set(hidden.map((row) => row.trigger_id)), online).find((found) => found.id === trigger) : undefined;

  if (summaries && hidden && !thread) {
    return (
      <Screen title={t("title")}>
        <Empty icon="time" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }

  async function remove() {
    if (!thread) return;
    if (!(await confirm({ title: t("delete.title"), message: t("delete.message"), action: t("delete.action"), cancel: t("cancel"), destructive: true }))) return;
    await hideThread(database, thread.id);
    router.back();
  }

  return (
    <Screen title={t("title")} subtitle={agent?.name}>
      {thread?.text ? <Note tone="plain">{thread.text}</Note> : null}
      {thread && (
        <Section title={t("rounds", { count: thread.rounds.length })} footer={t("footer")}>
          {thread.rounds.map((round) => (
            <Row
              key={round.task}
              leading={<Dot color={STATUS_DOT[round.status]} size={9} />}
              title={round.quiet ? t("quiet") : round.title || t("untitled")}
              detail={new Date(round.at).toLocaleString(language, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              onPress={() => router.push({ pathname: "/tasks/[task]", params: { task: round.task, agent: agentId } })}
            />
          ))}
        </Section>
      )}
      {thread && (
        <Section>
          <Row icon="trash" title={t("delete.row")} destructive onPress={() => void remove()} />
        </Section>
      )}
    </Screen>
  );
}
