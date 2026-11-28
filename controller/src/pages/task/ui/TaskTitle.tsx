import { router } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { isBudgetOut, TaskStatusLabel, type Latest, type TaskEventRow, type TaskStatus } from "../../../entities/task";
import { useT } from "../../../shared/i18n";
import { Icon, space, Text } from "../../../shared/ui";

// The back and settings buttons with the bar's margins around them.
const BAR_BUTTON = 76;

type Props = { readOnly: boolean; agent: AgentRow; status: TaskStatus; latest: Latest; events: readonly TaskEventRow[]; online: boolean | null; title: string; task: string };

/**
 * The boards' title for each state: a deleted Agent's grey name and trash, and otherwise the Character doing what this Task does beside the name, with the Task's title under the name
 * (its status until it has one). The page puts that one beside the back button. A tap opens the Agent's
 * page, as the settings button does; a deleted Agent has no page.
 */
export function TaskTitle({ readOnly, agent, status, latest, events, online, title, task }: Props) {
  const t = useT("task");
  const { width } = useWindowDimensions();
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
  // Beside the back button it leaves room for that and the settings button, and a long title ends in "…".
  const room = width - 2 * BAR_BUTTON;
  return (
    <Pressable
      role="button"
      aria-label={t("openDetails")}
      onPress={() => router.push({ pathname: "/tasks/[task]/details", params: { task, agent: agent.id } })}
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1, maxWidth: room }}
    >
      <Character look={lookOfJson(agent.character)} mood={moodOf(events, online)} size={52} />
      <View style={{ alignItems: "flex-start", flexShrink: 1 }}>
        <Text variant="headline" numberOfLines={1}>
          {agent.name}
        </Text>
        {title ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {title}
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
