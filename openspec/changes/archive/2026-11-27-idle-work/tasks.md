## 1. Protocol

- [x] 1.1 `kind: "idle"` และ `idle` (items, order, quietMinutes, itemMinutes) ใน `trigger.set`; `items` ที่มีสถานะ, `draft` ใน `trigger.listed`; `backgroundShare` ใน `agent.update`/`agent.listed` ทั้ง Rust และ TypeScript; vectors ผ่านและไม่ผ่าน; ตรวจด้วย `bun run check:protocol`

## 2. Runtime core

- [x] 2.1 `TriggerRun.limit_s`: Turn ถูก cancel เมื่อครบ และจบด้วย `code: "trigger.time_limit"`; test ใน `runtime-core/tests/agent.rs`
- [x] 2.2 tool `propose_idle_work` ในทุก Turn ส่ง `FromWorker::IdleProposed`; test ใน `runtime-core/tests/agent.rs`

## 3. supervisor

- [x] 3.1 `TriggerRecord` รับ `idle` และสถานะต่อชิ้น; ลิสต์เดียวต่อ Agent; เก็บสถานะของ `id` เดิม; unit test ใน `triggers.rs`
- [x] 3.2 กฎการตื่น (เงียบครบ, ทีละชิ้น, ordered/oldest-first, ไม่ชดเชย) เป็นฟังก์ชันที่ test ได้ และต่อเข้า `tick_triggers`; unit test
- [x] 3.3 จบงาน: `turn.ended` ของ Task ของชิ้น → `done`/`timedOut`/`needsApproval`, `repeat` กลับเป็น `pending`, ชิ้นที่ค้าง `working` ตอนเริ่มใหม่เป็น `timedOut`; binary test ใน `tests/triggers.rs`
- [x] 3.4 ร่าง: `IdleProposed` ต่อท้ายร่าง (สูงสุด 50) ส่งใน `trigger.listed` และล้างเมื่อเซ็นลิสต์ใหม่; test
- [x] 3.5 `background_share` ในแถว Agent, usage ที่มา `idle`, ไม่เริ่มชิ้นใหม่และ Stop Turn ของ Idle Work เมื่อถึงเพดาน; test

## 4. Controller

- [x] 4.1 page slice `agent-idle-work` (`/keel:add-unit`), route `agents/[agent]/idle` และ sheet `agents/[agent]/idle/edit`, แถวในหน้า Agent
- [x] 4.2 รายการชิ้นพร้อมสถานะ กดไปที่ Task, ร่างจาก Agent, sheet แก้และเซ็น, สวิตช์พัก
- [x] 4.3 เพดานงานพื้นหลังในหน้า Idle Work (เลือกเปอร์เซ็นต์) อยู่ติดกับสวิตช์เปิดใช้ เพราะเป็นของรอบที่ไม่มีคนเฝ้า
- [x] 4.4 คำไทยและอังกฤษ; ลองบน Simulator สว่างและมืด

## 5. ตรวจ

- [x] 5.1 `bun run check`, `bun run test`, `bun run test:e2e` และ e2e ใหม่ที่ส่งลิสต์ `idle` ผ่าน relay จริง แล้ว `trigger.run` ได้ Task ของชิ้นแรก (กฎการตื่นตามเวลาตรวจด้วย unit test ที่ใส่เวลาเอง)
