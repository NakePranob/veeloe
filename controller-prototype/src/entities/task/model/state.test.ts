import { expect, test } from "bun:test";
import { parseMarkdown, plainFirstLine } from "../../../shared/lib";
import { demoTasks } from "./demo";
import { approvals, moodOf, pendingApproval, preview, queued, stateOf, statusOf, toolResults } from "./state";
import type { EventBody, TaskEvent } from "./types";

const NOW = 1_000_000_000;
const [deploy, review, e2e] = demoTasks(NOW);

const after = (events: TaskEvent[], ...bodies: EventBody[]): TaskEvent[] => [
  ...events,
  ...bodies.map((body, i) => ({ ...body, seq: events.length + i + 1, at: NOW })),
];

test("an unanswered Approval makes the Task wait on you", () => {
  expect(stateOf(deploy.events, NOW)).toBe("waiting");
  expect(preview(deploy.events, NOW)).toBe("npm run deploy:prod");
});

test("answering, expiry or a Stop closes the Approval", () => {
  const answered = after(deploy.events, { type: "approval_answer", id: "a1", approved: true });
  expect(pendingApproval(answered, NOW)).toBeUndefined();
  expect(stateOf(answered, NOW)).toBe("working");
  expect(stateOf(deploy.events, NOW + 2 * 60 * 60_000)).toBe("working");
  const stopped = after(deploy.events, { type: "stop" }, { type: "turn_end" });
  expect(stateOf(stopped, NOW)).toBe("done");
  expect(preview(stopped, NOW)).toBe("คุณหยุด Turn นี้");
});

test("each Approval has one outcome, whatever closed it", () => {
  const answer = (approved: boolean) => after(deploy.events, { type: "approval_answer", id: "a1", approved });
  expect(approvals(deploy.events, NOW).get("a1")).toBe("open");
  expect(approvals(answer(true), NOW).get("a1")).toBe("approved");
  expect(approvals(answer(false), NOW).get("a1")).toBe("denied");
  expect(approvals(deploy.events, NOW + 2 * 60 * 60_000).get("a1")).toBe("expired");
  expect(approvals(after(deploy.events, { type: "stop" }, { type: "turn_end" }), NOW).get("a1")).toBe("closed");
  // An answer after the Turn ended changes nothing.
  expect(approvals(after(deploy.events, { type: "turn_end" }, { type: "approval_answer", id: "a1", approved: true }), NOW).get("a1")).toBe("closed");
});

test("a command cut off by Stop reports as stopped, not running", () => {
  expect(toolResults(review.events).get("t2")).toBeUndefined();
  expect(toolResults(after(review.events, { type: "stop" }, { type: "turn_end" })).get("t2")).toEqual({ ok: false, output: "หยุดก่อนเสร็จ", stopped: true });
  expect(toolResults(review.events).get("t1")).toEqual({ ok: true, output: "แก้ 14 ไฟล์ +412 −98" });
});

test("an offline Machine outranks the Task's own state", () => {
  expect(statusOf(deploy.events, false, NOW)).toBe("offline");
  expect(statusOf(deploy.events, true, NOW)).toBe("waiting");
});

test("an open Turn is working and an ended one is done", () => {
  expect(stateOf(review.events, NOW)).toBe("working");
  expect(stateOf(e2e.events, NOW)).toBe("done");
  expect(preview(e2e.events, NOW)).toBe("ผ่าน 41 จาก 42 ตัว ตัวที่พังคือ checkout › empty cart ตะกร้าว่างแล้วปุ่มชำระเงินยังกดได้");
});

test("the Character's Mood follows the events", () => {
  expect(moodOf(deploy.events, true, NOW)).toBe("waiting");
  expect(moodOf(deploy.events, false, NOW)).toBe("offline");
  expect(moodOf(review.events, true, NOW)).toBe("working");
  expect(moodOf(after(review.events, { type: "tool_result", id: "t2", ok: true, output: "" }), true, NOW)).toBe("thinking");
  expect(moodOf(after(review.events, { type: "stop" }, { type: "turn_end" }), true, NOW)).toBe("idle");
  expect(moodOf(e2e.events, true, NOW)).toBe("done");
  expect(moodOf([], true, NOW)).toBe("idle");
});

test("a message sent mid-Turn is queued until the Turn ends", () => {
  const sent = after(review.events, { type: "message", text: "เน้น index ด้วย" });
  expect([...queued(sent)]).toEqual([sent.at(-1)!.seq]);
  expect(queued(after(sent, { type: "turn_end" })).size).toBe(0);
  expect(queued(after(e2e.events, { type: "message", text: "แก้ให้หน่อย" })).size).toBe(0);
});

test("an Agent's Markdown comes apart into blocks and inline pieces", () => {
  expect(parseMarkdown("## สรุป\nรัน `npm test` แล้ว **ผ่าน**\n- ดู [PR](https://github.com/x/y/pull/1)\n2. [ไม่เปิด](file:///etc)\n```sh\nnpm test\n```")).toEqual([
    { kind: "heading", inline: [{ text: "สรุป" }] },
    { kind: "paragraph", inline: [{ text: "รัน " }, { text: "npm test", code: true }, { text: " แล้ว " }, { text: "ผ่าน", bold: true }] },
    { kind: "item", marker: "•", inline: [{ text: "ดู " }, { text: "PR", link: "https://github.com/x/y/pull/1" }] },
    { kind: "item", marker: "2.", inline: [{ text: "[ไม่เปิด](file:///etc)" }] },
    { kind: "code", text: "npm test" },
  ]);
  expect(plainFirstLine("ใช้ `rg` **ก่อน**\nแล้วค่อยแก้")).toBe("ใช้ rg ก่อน");
});
