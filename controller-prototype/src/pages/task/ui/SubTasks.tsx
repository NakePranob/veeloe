import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Character, useAgents } from "../../../entities/agent";
import { memberName } from "../../../entities/member";
import { moodOf, statusOf, TaskStatus, toolResults, type Task } from "../../../entities/task";
import { queuePosition, useProjectWaits, useRuntime } from "../../../features/demo-runtime";
import { Button, Card, Icon, Label, space, Text } from "../../../shared/ui";
import { AgentText } from "./AgentText";

// The Entry's sub-Tasks as cards that update live: who has what, in what state, and what came back.
// They read like the employee's own chat, but only the Entry writes to them (ADR 0045).
export function SubTasks({ children, now }: { children: Task[]; now: number }) {
  const agents = useAgents();
  const runtime = useRuntime();
  const waits = useProjectWaits();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={{ gap: space.sm }}>
      <Label icon="thread" variant="footnote">
        งานของพนักงาน {children.length} Task
      </Label>
      {children.map((child) => {
        const agent = agents.find((candidate) => candidate.id === child.agent);
        if (!agent) return null;
        const status = statusOf(child.events, agent.machine.online, now);
        const results = toolResults(child.events);
        const message = child.events.find((event) => event.type === "message");
        // Why it is not running yet: the Agent's queue, or the checkout or Worktree being written by another Turn.
        const position = message ? queuePosition(runtime, agent.id, message.seq, child.id) : 0;
        const note = position ? `รอคิวที่ ${position} · ${agent.name} ยังมีงานอื่น` : waits[child.id] ? `รอ ${child.worktree ? "Worktree" : "checkout หลัก"} ว่าง · มี Turn อื่นกำลังเขียน` : null;
        const last = child.events.findLast((event) => event.type === "text");
        const expanded = open === child.id;
        return (
          <Card key={child.id}>
            <Pressable role="button" aria-expanded={expanded} onPress={() => setOpen(expanded ? null : child.id)} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Character look={agent.character} mood={moodOf(child.events, agent.machine.online, now)} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text strong numberOfLines={1}>
                  {agent.name}
                </Text>
                {/* A Turn that has not started has no state of its own yet, only its place in line. */}
                {!position && <TaskStatus status={status} variant="caption" />}
                {note && (
                  <Label icon="time" variant="caption">
                    {note}
                  </Label>
                )}
              </View>
              <Icon name={expanded ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />
            </Pressable>
            {expanded && (
              <View style={{ gap: space.sm }}>
                {message?.type === "message" && (
                  <Text variant="footnote" tone="secondary">
                    งานที่ได้รับในนาม {memberName(message.member)}: {message.text}
                  </Text>
                )}
                {child.events
                  .filter((event) => event.type === "tool_call")
                  .map((call) =>
                    call.type === "tool_call" ? (
                      <Text key={call.seq} variant="footnote" tone="secondary" mono>
                        {call.command}
                        {results.get(call.id) ? `  →  ${results.get(call.id)?.output}` : ""}
                      </Text>
                    ) : null,
                  )}
                {last?.type === "text" && <AgentText text={last.text} />}
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="เปิด Task ย่อย" onPress={() => router.push(`/tasks/${child.id}`)} />
                </View>
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );
}
