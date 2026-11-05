import { router } from "expo-router";
import { Pressable, View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import type { TaskEventRow } from "../../../entities/task";
import { useLanguage, useT } from "../../../shared/i18n";
import { useNow, when } from "../../../shared/lib";
import { motion, space, Text } from "../../../shared/ui";

// The top of the log, as in controller-prototype's TaskPage: the Agent's Character doing what this
// Task is doing, and under it the Machine and when the Task started.
export function LogHead({ agent, machine, events, online }: { agent: AgentRow; machine: string; events: TaskEventRow[]; online: boolean | null }) {
  const t = useT("task");
  const language = useLanguage();
  const now = useNow();
  return (
    <View style={{ alignItems: "center", gap: space.xs, paddingBottom: space.sm }}>
      {/* Tapping the Agent's Character opens the Agent, as the settings button does. */}
      <Pressable role="button" aria-label={t("openAgent", { name: agent.name })} hitSlop={space.xs} onPress={() => router.push({ pathname: "/agents/[agent]", params: { agent: agent.id } })}>
        {({ pressed }) => (
          <View style={{ transform: [{ scale: pressed ? motion.press : 1 }] }}>
            <Character look={lookOfJson(agent.character)} mood={moodOf(events, online)} size={56} />
          </View>
        )}
      </Pressable>
      <Text variant="caption" tone="secondary">
        {events[0] ? t("started", { machine, when: when(events[0].at, language, now) }) : t("notStarted", { machine })}
      </Text>
    </View>
  );
}
