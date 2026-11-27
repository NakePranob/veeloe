import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { headsOf, STATUS_DOT, statusOf, titleOf, useAgentTaskSummaries, useThreadHeads } from "../../../entities/task";
import { useMachineStatus } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { column, Dot, Row, Spinner, space } from "../../../shared/ui";

/** How many Tasks one read brings; scrolling near the end reads the next page. */
const PAGE = 30;

/**
 * Every Task, or every Schedule thread, of one Agent in a sheet over its page, which shows only the newest few.
 * Tasks are read a page at a time as the list nears its end, so a long history never loads at once.
 */
export function AgentAllSheet() {
  const t = useT("agent");
  const { agent: id, show } = useLocalSearchParams<{ agent: string; show?: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const online = useMachineStatus(agent?.machine_id ?? "").online;
  return (
    <>
      <Stack.Screen options={{ title: show === "threads" ? t("allThreads") : t("allTasks") }} />
      {agent && (show === "threads" ? <Threads agentId={agent.id} online={online} /> : <Tasks agentId={agent.id} online={online} />)}
    </>
  );
}

function Tasks({ agentId, online }: { agentId: string; online: boolean | null }) {
  const t = useT("agent");
  const status = useT("task-status");
  const language = useLanguage();
  const now = useNow();
  const [limit, setLimit] = useState(PAGE);
  const tasks = useAgentTaskSummaries(agentId, limit);
  // A full page means there may be more; a short one is the end.
  const more = tasks !== null && tasks.length === limit;
  if (!tasks) return <Spinner />;
  return (
    <FlatList
      data={tasks}
      keyExtractor={(task) => task.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[column, { paddingVertical: space.sm }]}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (more) setLimit(limit + PAGE);
      }}
      ListFooterComponent={
        more ? (
          <View style={{ padding: space.lg }}>
            <Spinner />
          </View>
        ) : undefined
      }
      renderItem={({ item: task }) => (
        <Row
          leading={<Dot color={STATUS_DOT[statusOf(task, online)]} size={9} />}
          title={titleOf(task) || t("tasks.untitled")}
          detail={task.events ? t("tasks.detail", { status: status(statusOf(task, online)), when: when(task.updated_at, language, now) }) : status(statusOf(task, online))}
          // The Task takes the sheet's place, as the Task details sheet opens its Task.
          onPress={() => router.replace({ pathname: "/tasks/[task]", params: { task: task.id, agent: agentId } })}
        />
      )}
    />
  );
}

function Threads({ agentId, online }: { agentId: string; online: boolean | null }) {
  const t = useT("agent");
  const heads = useThreadHeads(agentId, true);
  if (!heads) return <Spinner />;
  const threads = headsOf(heads, online);
  return (
    <FlatList
      data={threads}
      keyExtractor={(thread) => thread.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[column, { paddingVertical: space.sm }]}
      renderItem={({ item: thread }) => (
        <Row
          icon="time"
          title={thread.text.split("\n")[0] || t("threads.untitled")}
          value={t("threads.rounds", { count: thread.rounds })}
          onPress={() => router.replace({ pathname: "/threads/[trigger]", params: { trigger: thread.id, agent: agentId } })}
        />
      )}
    />
  );
}
