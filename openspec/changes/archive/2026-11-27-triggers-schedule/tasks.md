## 1. ADR

- [x] 1.1 แก้ ADR 0067 ให้ชี้ไปที่ spec แม่ (#53) แทน `docs/roadmap.md`; ตรวจด้วย `grep roadmap docs/adr/0067*` ไม่เจอ

## 2. Protocol

- [x] 2.1 เพิ่ม `trigger.set/pause/resume/delete/run/list/listed` ใน `packages/protocol/src/messages.rs` พร้อมการตรวจ schedule; ตรวจด้วย `cargo test` ใน `packages/protocol`
- [x] 2.2 เพิ่ม schema เดียวกันใน `packages/protocol-ts/src/messages/trigger.ts` และ `index.ts`; ตรวจด้วย `bun test src/fixtures`
- [x] 2.3 เพิ่ม vectors ใน `packages/protocol/vectors/messages.json` (ผ่านและไม่ผ่าน) ให้สองฝั่งตัดสินตรงกัน; ตรวจด้วย `bun run check:protocol`

## 3. Runtime core

- [x] 3.1 `ToWorker::Run` ที่มี `trigger` เขียน `member.message` และ `turn.started` ที่มี `trigger` กับ `member`; ตรวจด้วย test ใน `runtime-core/tests/agent.rs`
- [x] 3.2 `nothing_to_report` มีเฉพาะ Turn ของ Trigger และจบ Turn ด้วย `quiet`; ตรวจด้วย test ใน `runtime-core/tests/agent.rs`

## 4. supervisor

- [x] 4.1 ที่เก็บ Trigger (`triggers.rs`) โหลดใหม่ได้ แทนที่ตาม `id` และระงับตามกุญแจ; ตรวจด้วย unit test ใน `triggers.rs`
- [x] 4.2 คำนวณรอบของ every/daily/weekly และรอบที่พลาด; ตรวจด้วย unit test ที่ใส่เวลาเอง
- [x] 4.3 `Trust::uses` และข้อความ `trigger.*` ใน `messages/trigger.rs` + `dispatch`; ตรวจด้วย binary test ใน `tests/triggers.rs`
- [x] 4.4 ตัวนับรอบใน `main.rs`: ข้ามเมื่อไม่ว่างหรือ Budget หมด ถังขยะ ระงับเมื่อถอนกุญแจ; ตรวจด้วย unit test ของฟังก์ชันตัดสินรอบ
- [x] 4.5 usage source `schedule`; ตรวจด้วย test ของ `Budgets`

## 5. Controller

- [x] 5.1 `links.ts` ส่งและรับ `trigger.*` และเก็บ `trigger.listed`; ตรวจด้วย `bunx tsc --noEmit`
- [x] 5.2 model ของฟอร์ม Schedule (ตรวจค่า, สร้าง body) และการบอกรอบ; ตรวจด้วย `bun test` ของ model
- [x] 5.3 หน้า Schedule, route และแถวในหน้า Agent พร้อมคำไทย/อังกฤษ; ตรวจด้วย `bun run check:controller`
- [x] 5.4 Inbox ซ่อน Task ที่จบแบบ quiet; ตรวจด้วย test ของ model ของ Inbox

## 6. ตรวจ

- [x] 6.1 `bun run check` และ `bun run test` ผ่าน
- [x] 6.2 test:e2e ผ่าน relay: `trigger.set` แล้ว `trigger.run` ได้ Task ใหม่ที่ `turn.started` มี `trigger`; ตรวจด้วย `bun run test:e2e`
- [x] 6.3 ลองบน Simulator: สร้าง Schedule รันทันที แล้วเห็น Task ใหม่
