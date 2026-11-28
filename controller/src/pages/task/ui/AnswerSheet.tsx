import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { allowlistOf, useAgents } from "../../../entities/agent";
import { lookOfJson } from "../../../entities/character";
import { useOpenTasks, useTaskEvents } from "../../../entities/task";
import { useMachineLink } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { useNow } from "../../../shared/lib";
import { Button, Screen, space } from "../../../shared/ui";
import { nextToAnswer } from "../model/answer";
import { items } from "../model/items";
import { useTaskScreen } from "../model/use-task-screen";
import { ApprovalCard } from "./ApprovalCard";

/**
 * Answers an Approval from the Inbox without opening the Task (ADR 0092): the same card as in the Task, in a sheet.
 * Once this device's answer lands it moves to the next Approval waiting on this Member, or closes. One answered
 * elsewhere or timed out stays on screen as its outcome, so nobody answers it twice, with a way on.
 */
export function AnswerSheet() {
  const t = useT("task");
  const { task, agent: agentId } = useLocalSearchParams<{ task: string; agent: string }>();
  const screen = useTaskScreen(task, agentId);
  const link = useMachineLink();
  const events = useTaskEvents(task);
  const open = useOpenTasks();
  const agents = useAgents();
  const now = useNow();
  // The Task this device answered in the sheet: keyed by Task, so moving on to the next starts clean.
  const [answered, setAnswered] = useState<string | null>(null);
  const log = useMemo(() => (events ? items(events, now).items : null), [events, now]);
  const approvals = log?.flatMap((item) => (item.kind === "approval" ? [item.approval] : [])) ?? [];
  const approval = approvals.find((a) => a.status === "open") ?? approvals.at(-1);
  const waiting = approval?.status === "open";
  const next = open ? nextToAnswer(open, task, (agent) => agents?.find((a) => a.id === agent)?.level) : null;

  const moveOn = () => (next ? router.setParams({ task: next.id, agent: next.agent_id }) : router.back());
  // biome-ignore lint/correctness/useExhaustiveDependencies: moves once this device's own answer has landed, not on every list change
  useEffect(() => {
    if (answered === task && approval && !waiting) moveOn();
  }, [answered, task, waiting]);

  if (!screen || !events || !approval) return <Screen title={t("answerSheet.title")}>{null}</Screen>;
  const { agent, machine, readOnly, status } = screen;
  // Someone who did not start this Task has only its Approvals here (ADR 0060): there is no conversation to open.
  const conversation = events.some((event) => event.kind === "member.message");
  const openTask = () => router.replace({ pathname: "/tasks/[task]", params: { task, agent: agent.id } });

  return (
    <Screen title={t("answerSheet.title")}>
      <View style={{ paddingTop: space.xl, gap: space.md }}>
        <ApprovalCard
          // A new card per request: moving on must not carry the last one's "sent" over.
          key={approval.request}
          approval={approval}
          agentName={agent.name}
          look={lookOfJson(agent.character)}
          allowlist={allowlistOf(agent) ?? []}
          canAnswer={!readOnly && agent.level !== "use"}
          canManage={!readOnly && agent.level === "manage"}
          online={status.online !== false && !!link}
          now={now}
          me={machine?.member_id}
          onAnswer={({ decision, allowAlways, subdomains }) => {
            const sent =
              link && machine ? link.answerApproval(machine, { agent: agent.id, task, request: approval.request, decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }), ...(subdomains === true && { subdomains }) }) : null;
            if (sent) setAnswered(task);
            return sent;
          }}
          // Saying what to do instead needs the composer, which is in the Task.
          onSteer={openTask}
        />
        <View style={{ flexDirection: "row", gap: space.md, justifyContent: "center" }}>
          {conversation && <Button label={t("answerSheet.conversation")} onPress={openTask} />}
          {!waiting && <Button label={next ? t("answerSheet.next") : t("answerSheet.close")} variant="primary" onPress={moveOn} />}
        </View>
      </View>
    </Screen>
  );
}
