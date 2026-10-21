import type { Task } from "./types";

// ponytail: the deploy story from the HTML prototype. Message text is user content, so it stays in one language.
export const TASKS: Task[] = [
  {
    id: "deploy",
    agent: "deployer",
    title: "deploy production",
    when: "ตอนนี้",
    state: "waiting",
    messages: [
      { kind: "me", text: "deploy เวอร์ชันล่าสุดขึ้น production ให้หน่อย" },
      { kind: "agent", by: "deployer", text: "ได้เลย ขอเช็ก test ก่อน แล้วให้ builder บน build-box ช่วย build assets ไปพร้อมกัน" },
      { kind: "delegation", task: "build", agent: "builder", machine: "build-box", title: "build assets" },
      { kind: "agent", by: "deployer", text: "test ผ่านครบ 128 ตัว และไม่มีไฟล์ค้างใน git ระหว่างที่ builder build assets อยู่ ขออนุมัติ deploy ไว้ก่อน จะได้เริ่มทันทีที่ build เสร็จ" },
    ],
    approval: {
      command: "npm run deploy:prod",
      summary: "deploy ขึ้น production (3 เครื่อง) เมื่อ build เสร็จ · บน mac-studio",
      expiresAt: Date.now() + 58 * 60_000,
    },
    steps: [
      { label: "อ่าน package.json", state: "done", seconds: 0.1 },
      { label: "รัน npm test · ผ่าน 128 ตัว", state: "done", seconds: 38 },
      { label: "ส่งต่อให้ builder · build assets", state: "done", seconds: 41 },
      { label: "เช็ก git status", state: "done", seconds: 0.4 },
      { label: "รอคุณอนุมัติ", state: "live" },
      { label: "อัปโหลดและสลับ traffic ไปเวอร์ชันใหม่", state: "next" },
      { label: "เช็ก health ทั้ง 3 เครื่อง", state: "next" },
    ],
  },
  {
    id: "build",
    agent: "builder",
    parent: "deploy",
    title: "build assets",
    when: "ตอนนี้",
    state: "working",
    messages: [
      { kind: "agent", by: "deployer → builder", text: "build assets สำหรับ 2.4.0 แล้วส่งขนาดกลับมา" },
      { kind: "agent", by: "builder", text: "กำลัง build…" },
    ],
  },
  {
    id: "review",
    agent: "reviewer",
    title: "รีวิว PR #42",
    when: "12 นาที",
    state: "done",
    unread: true,
    messages: [
      { kind: "me", text: "รีวิว PR #42 ให้หน่อย" },
      { kind: "agent", by: "reviewer", text: "ทิ้งความเห็นไว้ 3 ข้อ ข้อสำคัญคือ query ใน orders ยังไม่มี index ทำให้หน้า orders ช้าเมื่อข้อมูลเยอะ" },
    ],
  },
  {
    id: "e2e",
    agent: "tester",
    title: "e2e ของ PR #42",
    when: "40 นาที",
    state: "done",
    unread: true,
    messages: [
      { kind: "me", text: "รัน e2e ของ PR #42 บน build-box" },
      { kind: "agent", by: "tester", text: "ผ่าน 41 จาก 42 ตัว ตัวที่พังคือ checkout ตอนที่ตะกร้าว่าง" },
    ],
  },
  {
    id: "draft",
    agent: "writer",
    title: "ร่าง release notes",
    when: "2 ชม.",
    state: "idle",
    messages: [{ kind: "me", text: "ร่าง release notes ของ 2.4.0" }],
  },
  {
    id: "images",
    agent: "janitor",
    title: "ล้าง Docker image เก่า",
    when: "เมื่อวาน",
    state: "done",
    messages: [
      { kind: "me", text: "ล้าง Docker image ที่ไม่ได้ใช้บน mac-studio" },
      { kind: "agent", by: "janitor", text: "ลบไป 23 image ได้พื้นที่คืนมา 9 GB" },
    ],
  },
  {
    id: "logs",
    agent: "deployer",
    title: "หมุน log ของ nginx",
    when: "เมื่อวาน",
    state: "done",
    messages: [
      { kind: "me", text: "หมุน log ของ nginx บน production" },
      { kind: "agent", by: "deployer", text: "หมุนแล้วทั้ง 3 เครื่อง ได้พื้นที่คืนมา 12 GB" },
    ],
  },
];
