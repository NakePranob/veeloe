import type { EventBody, Task, TaskEvent } from "./types";

const MINUTE = 60_000;

// Events written as [minutes ago, body], numbered in order.
function log(now: number, entries: [number, EventBody][]): TaskEvent[] {
  return entries.map(([minutesAgo, body], i) => ({ ...body, seq: i + 1, at: now - minutesAgo * MINUTE }));
}

// ponytail: the Demo Workspace's Tasks (ADR 0024). Message text is user content, so it stays in Thai.
export function demoTasks(now: number): Task[] {
  return [
    {
      id: "deploy",
      agent: "deployer",
      title: "deploy 2.4.0 ขึ้น production",
      events: log(now, [
        [6, { type: "message", text: "deploy เวอร์ชันล่าสุดขึ้น production ให้หน่อย" }],
        [6, { type: "turn_start" }],
        [6, { type: "text", text: "ได้เลย ขอเช็ก test กับ git ก่อน" }],
        [5, { type: "tool_call", id: "t1", command: "npm test" }],
        [4, { type: "tool_result", id: "t1", ok: true, output: "ผ่าน 128 จาก 128 ตัว" }],
        [4, { type: "tool_call", id: "t2", command: "git status --short" }],
        [4, { type: "tool_result", id: "t2", ok: true, output: "ไม่มีไฟล์ค้าง" }],
        [3, { type: "text", text: "test ผ่านครบและ working tree สะอาด ขั้นต่อไปคือ `npm run deploy:prod` ซึ่งไม่อยู่ใน Allowlist ขออนุมัติก่อนนะ" }],
        [3, { type: "approval_request", id: "a1", command: "npm run deploy:prod", reason: "deploy 2.4.0 ขึ้น production ทั้ง 3 เครื่อง", expiresAt: now + 57 * MINUTE }],
      ]),
    },
    {
      id: "review",
      agent: "reviewer",
      title: "รีวิว PR #42",
      events: log(now, [
        [2, { type: "message", text: "รีวิว PR #42 ให้หน่อย เน้นเรื่อง performance" }],
        [2, { type: "turn_start" }],
        [2, { type: "tool_call", id: "t1", command: "gh pr diff 42" }],
        [1, { type: "tool_result", id: "t1", ok: true, output: "แก้ 14 ไฟล์ +412 −98" }],
        [1, { type: "text", text: "เจอจุดน่าห่วงหนึ่งจุด query ใน `orders/list.ts` ไม่มี index:\n```sql\nSELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC\n```\nกำลังเช็กว่ามี migration ที่เพิ่ม index ไว้แล้วหรือยัง" }],
        [0, { type: "tool_call", id: "t2", command: "rg -n \"CREATE INDEX\" migrations/" }],
      ]),
    },
    {
      id: "e2e",
      agent: "tester",
      title: "e2e ของ PR #42",
      events: log(now, [
        [48, { type: "message", text: "รัน e2e ของ PR #42 บน build-box" }],
        [48, { type: "turn_start" }],
        [47, { type: "tool_call", id: "t1", command: "bun run --cwd e2e test" }],
        [41, { type: "tool_result", id: "t1", ok: false, output: "ผ่าน 41 จาก 42 ตัว" }],
        [40, { type: "text", text: "ผ่าน 41 จาก 42 ตัว ตัวที่พังคือ `checkout › empty cart` ตะกร้าว่างแล้วปุ่มชำระเงินยังกดได้" }],
        [40, { type: "turn_end" }],
      ]),
    },
    {
      id: "notes",
      agent: "writer",
      title: "ร่าง release notes",
      events: log(now, [
        [150, { type: "message", text: "ร่าง release notes ของ 2.4.0" }],
        [150, { type: "turn_start" }],
        [148, { type: "text", text: "ร่างไว้ที่ `docs/releases/2.4.0.md` แล้ว มีสามหัวข้อ: หน้าชำระเงินใหม่, index ของ orders และการแก้ bug 6 ตัว" }],
        [148, { type: "turn_end" }],
      ]),
    },
  ];
}
