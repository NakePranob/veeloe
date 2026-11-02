import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";
import { covers, missingParts, updateAgent, type Agent } from "../../../entities/agent";
import { memberName } from "../../../entities/member";
import type { ApprovalStatus, TaskEvent } from "../../../entities/task";
import { answerApproval, type Answer } from "../../../features/demo-runtime";
import { fromNow } from "../../../shared/lib";
import { authenticate, Button, Card, Field, Icon, Label, radius, space, Text, useColors, type IconName } from "../../../shared/ui";

interface Props {
  taskId: string;
  agent: Agent;
  request: Extract<TaskEvent, { type: "approval_request" }>;
  status: ApprovalStatus;
  answeredBy?: TaskEvent;
  canAnswer: boolean;
  canManage: boolean;
  now: number;
  // Puts the cursor in the composer so the Member can say what to do instead.
  onSteer: () => void;
  // Set when the reader has not seen this Task: the reason is the Agent's own, so they may read the conversation (ADR 0060).
  onOpenConversation?: () => void;
}

const OUTCOME: Record<Exclude<ApprovalStatus, "open">, { icon: IconName; color: "green" | "red"; text: string }> = {
  approved: { icon: "done", color: "green", text: "อนุมัติแล้ว" },
  denied: { icon: "failed", color: "red", text: "ปฏิเสธแล้ว" },
  expired: { icon: "failed", color: "red", text: "หมดเวลา นับว่าปฏิเสธ" },
  closed: { icon: "failed", color: "red", text: "Turn จบก่อนมีคนตอบ" },
};

async function respond(taskId: string, approvalId: string, answer: Answer) {
  // Answering takes a fresh unlock, so a phone left open cannot approve (ADR 0012).
  if (answer === "approve" && !(await authenticate("อนุมัติให้ Agent รันคำสั่งนี้"))) return;
  if (process.env.EXPO_OS === "ios") {
    Haptics.notificationAsync(answer === "approve" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }
  answerApproval(taskId, approvalId, answer);
}

// The one orange thing on the screen while it waits; once answered it settles
// into the log like any other event.
export function ApprovalCard({ taskId, agent, request, status, answeredBy, canAnswer, canManage, now, onSteer, onOpenConversation }: Props) {
  const colors = useColors();
  const open = status === "open";
  // "Allow always": what would go on the Allowlist, trimmed to the prefix the Member means (ADR 0030).
  const [entries, setEntries] = useState<string[] | null>(null);
  const by = answeredBy?.type === "approval_answer" && answeredBy.member ? ` โดย ${memberName(answeredBy.member)}` : "";

  async function allowAlways() {
    if (!entries || !(await authenticate(`เพิ่ม ${entries.join(", ")} เข้า Allowlist และอนุมัติ`))) return;
    updateAgent(agent.id, { allowlist: [...agent.allowlist, ...entries.map((entry) => entry.trim()).filter(Boolean)] });
    answerApproval(taskId, request.id, "approve");
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="approval" size="md" color={open ? "orange" : "tertiaryLabel"} />
        <Text variant="headline" style={{ flex: 1 }}>
          {agent.name} ขออนุมัติ
        </Text>
        {open && (
          <Label icon="time" iconColor="orange">
            หมดอายุใน {fromNow(request.expiresAt, now)}
          </Label>
        )}
      </View>
      <Text selectable>{request.reason}</Text>
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.fill }}>
        <Text variant="footnote" mono selectable>
          {request.command}
        </Text>
      </View>
      {!open && (
        <Label icon={OUTCOME[status].icon} iconColor={OUTCOME[status].color}>
          {OUTCOME[status].text}
          {by}
        </Label>
      )}
      {open && !canAnswer && (
        <Text variant="footnote" tone="secondary">
          รอคนที่มี Approve ตอบ
        </Text>
      )}
      {open && canAnswer && entries === null && (
        <>
          <Text variant="footnote" tone="secondary">
            ไม่อยู่ใน Allowlist ถ้าไม่ตอบก่อนหมดอายุจะนับว่าปฏิเสธ
          </Text>
          {/* One ink pill for the answer the card asks for; quiet chips beside it. "บอกให้ทำอย่างอื่น"
              is Codex's "Tell Codex what to do": a no that steers instead of ending the conversation. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs }}>
            <Button label="อนุมัติ" variant="primary" onPress={() => respond(taskId, request.id, "approve")} />
            <Button label="ปฏิเสธ" onPress={() => respond(taskId, request.id, "deny")} />
            {canManage && <Button label="อนุญาตตลอด" onPress={() => setEntries(missingParts(request.command, agent.allowlist))} />}
            <Button
              label="บอกให้ทำอย่างอื่น"
              onPress={() => {
                respond(taskId, request.id, "steer");
                onSteer();
              }}
            />
            {onOpenConversation && <Button label="ดูบทสนทนา" onPress={onOpenConversation} />}
          </View>
        </>
      )}
      {open && canAnswer && entries !== null && (
        <>
          {entries.map((entry, i) => (
            <Field
              key={i}
              mono
              label="เพิ่มเข้า Allowlist"
              value={entry}
              onChangeText={(text) => setEntries(entries.map((old, j) => (j === i ? text : old)))}
              footer={covers(entry, request.command) ? "ตัดท้ายให้เหลือคำนำหน้าที่ต้องการ รายการนี้ครอบทุกคำสั่งที่ขึ้นต้นแบบนี้" : "ไม่ครอบคำสั่งนี้ ยังต้องขออนุมัติ"}
            />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Button label="เซ็นและอนุมัติ" variant="primary" onPress={allowAlways} />
            <Button label="ยกเลิก" onPress={() => setEntries(null)} />
          </View>
        </>
      )}
    </Card>
  );
}
