import { router } from "expo-router";
import { Pressable, View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { isBudgetOut, TaskStatusLabel, type Latest, type TaskEventRow, type TaskStatus } from "../../../entities/task";
import { useT } from "../../../shared/i18n";
import { Icon, space, Text } from "../../../shared/ui";

type Props = { readOnly: boolean; agent: AgentRow; machineName: string; status: TaskStatus; latest: Latest; events: readonly TaskEventRow[]; online: boolean | null };

/**
 * The boards' title for each state: a deleted Agent's grey name and trash, a new Task's own title, and
 * otherwise the Character left of the name doing what this Task does, with the status under the name.
 * Waiting drops the head, since the Approval card under it already carries one. A tap opens the Agent's
 * page, as the settings button does; a deleted Agent has no page.
 */
export function TaskTitle({ readOnly, agent, machineName, status, latest, events, online }: Props) {
  const t = useT("task");
  if (readOnly)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="trash" size="md" color="tertiaryLabel" />
        <View>
          <Text variant="headline" tone="secondary" numberOfLines={1}>
            {t("deletedAgent")}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {t("deletedSubtitle")}
          </Text>
        </View>
      </View>
    );
  const centred = status === "new" || status === "waiting";
  return (
    <Pressable role="button" aria-label={t("openAgent", { name: agent.name })} onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {!centred && <Character look={lookOfJson(agent.character)} mood={moodOf(events, online)} size={52} />}
      <View style={{ alignItems: centred ? "center" : "flex-start" }}>
        <Text variant="headline" numberOfLines={1}>
          {status === "new" ? t("newTitle") : agent.name}
        </Text>
        {status === "new" ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {t("newSubtitle", { name: agent.name, machine: machineName })}
          </Text>
        ) : status === "waiting" ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {t("waitingHeader")}
          </Text>
        ) : status === "failed" && isBudgetOut(latest) ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {t("budgetHeader")}
          </Text>
        ) : status === "failed" ? (
          <Text variant="caption" tone="danger" numberOfLines={1}>
            {t("failedTitle")}
          </Text>
        ) : (
          <TaskStatusLabel status={status} variant="caption" />
        )}
      </View>
    </Pressable>
  );
}
