import { upsertThread } from "../../../entities/automation";
import { createTask, updateTask, type TaskEvent } from "../../../entities/task";

// Rounds that already happened, so a thread has history on a fresh Demo Workspace. They are
// older than the page, and the ones with something to say belong to Nok, not the Owner's Inbox.

const HOUR = 3_600_000;
const now = Date.now();

function round(origin: string, agent: string, starter: string, source: "schedule" | "watch", hoursAgo: number, message: string, reply: string | null) {
  const at = now - hoursAgo * HOUR;
  const events: TaskEvent[] = [
    { type: "message", text: message, member: starter, seq: 1, at },
    { type: "turn_start", seq: 2, at: at + 300 },
    ...(reply ? [{ type: "text" as const, text: reply, seq: 3, at: at + 1500 }] : [{ type: "text" as const, text: "ตรวจแล้ว ไม่มีอะไรต้องบอก", seq: 3, at: at + 1500 }]),
    { type: "turn_end", seq: 4, at: at + 1600 },
  ];
  const task = createTask({ agent, title: message.slice(0, 40), starter, source, origin, silent: !reply, shared: true });
  updateTask(task.id, { events });
}

const REVIEW = "ไล่ดู PR ที่ค้างรีวิวเกิน 1 วัน แล้วสรุปให้ ถ้าไม่มีให้เงียบ";
round("sch-prs", "reviewer", "m_nok", "schedule", 4 * 24 + 3, REVIEW, null);
round("sch-prs", "reviewer", "m_nok", "schedule", 3 * 24 + 3, REVIEW, "มี 2 PR ที่ค้างเกิน 1 วัน: #41 และ #44 ยังไม่มีใครรีวิว");
round("sch-prs", "reviewer", "m_nok", "schedule", 2 * 24 + 3, REVIEW, null);
round("sch-prs", "reviewer", "m_nok", "schedule", 24 + 3, REVIEW, null);
round("sch-prs", "reviewer", "m_nok", "schedule", 3, REVIEW, "PR #44 ค้างมา 3 วันแล้ว และยังไม่มี test ครอบ migration");
upsertThread({ origin: "sch-prs", title: "PR ที่ค้างรีวิว", agent: "reviewer", kind: "schedule" });

const MEMORY = "ย่อบันทึกของสัปดาห์นี้ลง MEMORY.md ให้ไม่เกิน 4,000 ตัวอักษร";
round("sch-memory", "writer", "m_kai", "schedule", 7 * 24 + 5, MEMORY, null);
round("sch-memory", "writer", "m_kai", "schedule", 5, MEMORY, null);
upsertThread({ origin: "sch-memory", title: "ย่อ MEMORY.md", agent: "writer", kind: "schedule" });

round("watch-notes", "deployer", "m_nok", "watch", 30, "มีไฟล์ใหม่ใน workdir/releases/ (2 ครั้งรวมเป็นงานเดียว)", "เช็กไฟล์ release 2.4.0 แล้ว ขาดบันทึกการเปลี่ยนแปลงของ migration");
round("watch-notes", "deployer", "m_nok", "watch", 8, "มีไฟล์ใหม่ใน workdir/releases/ (1 ครั้ง)", null);
upsertThread({ origin: "watch-notes", title: "workdir/releases/", agent: "deployer", kind: "watch" });
