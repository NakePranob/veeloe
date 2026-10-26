import * as Haptics from "expo-haptics";
import { View } from "react-native";
import { answerApproval, type Answer, type ApprovalStatus, type TaskEvent } from "../../../entities/task";
import { fromNow } from "../../../shared/lib";
import { Button, Card, Icon, Label, radius, space, Text, useColors, type IconName } from "../../../shared/ui";

interface Props {
  taskId: string;
  agent: string;
  request: Extract<TaskEvent, { type: "approval_request" }>;
  status: ApprovalStatus;
  now: number;
  // Puts the cursor in the composer so the Member can say what to do instead.
  onSteer: () => void;
}

const OUTCOME: Record<Exclude<ApprovalStatus, "open">, { icon: IconName; color: "green" | "red"; text: string }> = {
  approved: { icon: "done", color: "green", text: "คุณอนุมัติแล้ว" },
  denied: { icon: "failed", color: "red", text: "คุณปฏิเสธแล้ว" },
  expired: { icon: "failed", color: "red", text: "หมดเวลา นับว่าปฏิเสธ" },
  closed: { icon: "failed", color: "red", text: "Turn จบก่อนมีคนตอบ" },
};

function respond(taskId: string, approvalId: string, answer: Answer) {
  if (process.env.EXPO_OS === "ios") {
    Haptics.notificationAsync(answer === "approve" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }
  answerApproval(taskId, approvalId, answer);
}

// The one orange thing on the screen while it waits; once answered it settles
// into the log like any other event.
export function ApprovalCard({ taskId, agent, request, status, now, onSteer }: Props) {
  const colors = useColors();
  const open = status === "open";
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="approval" size="md" color={open ? "orange" : "tertiaryLabel"} />
        <Text variant="headline" style={{ flex: 1 }}>
          {agent} ขออนุมัติ
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
      {open ? (
        <>
          <Text variant="footnote" tone="secondary">
            ไม่อยู่ใน Allowlist ถ้าไม่ตอบก่อนหมดอายุจะนับว่าปฏิเสธ
          </Text>
          {/* One ink pill for the answer the card asks for; quiet chips beside it. "บอกให้ทำอย่างอื่น"
              is Codex's "Tell Codex what to do": a no that steers instead of ending the conversation. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs }}>
            <Button label="อนุมัติ" variant="primary" onPress={() => respond(taskId, request.id, "approve")} />
            <Button label="ปฏิเสธ" onPress={() => respond(taskId, request.id, "deny")} />
            <Button
              label="บอกให้ทำอย่างอื่น"
              onPress={() => {
                respond(taskId, request.id, "steer");
                onSteer();
              }}
            />
          </View>
        </>
      ) : (
        <Label icon={OUTCOME[status].icon} iconColor={OUTCOME[status].color}>
          {OUTCOME[status].text}
        </Label>
      )}
    </Card>
  );
}
