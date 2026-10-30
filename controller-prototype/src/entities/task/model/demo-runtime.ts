import { queued, turnOpen } from "./state";
import { append, eventsOf } from "./store";
import type { Effort } from "./types";

// The Demo Workspace's stand-in for a Runtime. Nothing leaves the phone
// (CONTEXT.md), so it answers on timers to let every flow be tried. It stays
// when the store moves to SQLite: App Store review runs on it (ADR 0024).
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function later(id: string, ms: number, run: () => void) {
  timers.set(id, [...(timers.get(id) ?? []), setTimeout(run, ms)]);
}

// Ends the Turn; a message queued during it then starts the next one.
function finishTurn(id: string, reply: string) {
  const waiting = queued(eventsOf(id)).size > 0;
  append(id, { type: "text", text: reply }, { type: "turn_end" });
  if (waiting) startTurn(id);
}

function startTurn(id: string) {
  later(id, 300, () => append(id, { type: "turn_start" }));
  later(id, 1500, () =>
    finishTurn(id, "นี่คือ **Demo Workspace** ข้อความไม่ได้ส่งไปที่ Machine ไหน\n- ต่อ Machine จริงเมื่อไหร่ ฉันจะทำงานให้จริง\n- ระหว่างนี้ลองกด Stop หรือตอบ Approval ดูได้"),
  );
}

export type Answer = "approve" | "deny" | "steer";

// "steer" denies and leaves the next move to the Member's own message.
export function answerApproval(taskId: string, approvalId: string, answer: Answer) {
  const request = eventsOf(taskId).find((event) => event.type === "approval_request" && event.id === approvalId);
  if (request?.type !== "approval_request") return;
  append(taskId, { type: "approval_answer", id: approvalId, approved: answer === "approve" });
  if (answer === "steer") {
    append(taskId, { type: "turn_end" });
    return;
  }
  if (answer === "deny") {
    later(taskId, 600, () => finishTurn(taskId, "รับทราบ ยังไม่ทำนะ ถ้าอยากให้ทำอย่างอื่นบอกได้เลย"));
    return;
  }
  later(taskId, 500, () => append(taskId, { type: "tool_call", id: approvalId, command: request.command }));
  later(taskId, 2500, () => {
    append(taskId, { type: "tool_result", id: approvalId, ok: true, output: "เสร็จใน 42 วินาที" });
    finishTurn(taskId, "เสร็จแล้ว health check ผ่านทั้ง 3 เครื่อง");
  });
}

export function sendMessage(taskId: string, text: string, effort: Effort) {
  const busy = turnOpen(eventsOf(taskId));
  append(taskId, { type: "message", text, effort });
  if (!busy) startTurn(taskId);
}

// ponytail: the demo has no Delegation, so there are no sub-Tasks to stop with it (ADR 0017).
export function stopTurn(taskId: string) {
  timers.get(taskId)?.forEach(clearTimeout);
  timers.delete(taskId);
  append(taskId, { type: "stop" }, { type: "turn_end" });
}
