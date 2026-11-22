## 1. Protocol

- [x] 1.1 เพิ่มค่าคงที่ `TaskTitled = "task.titled"` ใน `packages/protocol-ts/src/messages/task.ts` แยกจาก `TaskEventKind` พร้อม comment ว่า body คือ `{ title }` และทำไมถึงอยู่นอกชุดสถานะ แล้ว export จาก `index.ts` ตรวจด้วย `bun run check` ผ่าน (type check และ `check:protocol`)

## 2. Runtime

- [x] 2.1 ใน `runtime-core/src/agent.rs` เพิ่มฟังก์ชันที่ตัดสินจาก event ของ Task ว่าควรตั้งชื่อหรือไม่ (`turn.ended` ที่เป็น `done` มีตัวเดียว) และฟังก์ชันที่ทำความสะอาดคำตอบ (บรรทัดแรก ตัดเครื่องหมายคำพูด ไม่เกิน 60 ตัวอักษร) เขียน unit test ของทั้งสองให้ครอบกรณี done ตัวแรก, done ตัวที่สอง, Turn แรก stopped และคำตอบที่ยาวหรือมีหลายบรรทัด แล้วตรวจด้วย `cargo test -p veeloe-runtime-core`
- [x] 2.2 เพิ่ม `title_task` ที่สร้างคำขอตาม design ข้อ 5 เรียก `state.llm.send` แล้ว append `task.titled { title }` และเมื่อ error หรือได้คำตอบว่างก็ไม่ทำอะไร จากนั้นเรียกด้วย `tokio::spawn` ใน handle ของ `start_turn` หลัง `run_turn` ก่อน `drain_queued` ตรวจด้วย test ใน `runtime-core/tests/agent.rs` ที่ใช้ LLM ปลอมสามกรณี: Turn แรกจบแล้ว log มี `task.titled`, Provider ตอบ error ตอนตั้งชื่อแล้ว Turn ยังเป็น `done` และไม่มีชื่อ, Turn ที่สองไม่ขอชื่ออีก
- [x] 2.3 รัน `cargo fmt` และ `bun run check` (ส่วน `cargo test --workspace`) ผ่าน

## 3. Controller

- [x] 3.1 ใน `entities/task/model/tasks.ts` ให้ `LIST_TASK_SUMMARIES` ดึง `title_body` กับ `first_body` เพิ่ม field ใน `TaskSummary` และเพิ่ม `titleOf` ตาม design ข้อ 7 แล้ว export จาก `entities/task/index.ts` เขียน test ใน `tasks.test.ts` ให้ครอบกรณีมีชื่อ, ไม่มีชื่อแต่มีข้อความแรก, ไม่มีอะไรเลย, และ body ที่ไม่ใช่ JSON และเพิ่ม test ว่า `statusOf` ยังเป็น done เมื่อ `task.titled` มาหลัง `turn.ended` ตรวจด้วย `bun run test`
- [x] 3.2 ให้ `pages/agent/ui/AgentPage.tsx` ใช้ `titleOf(task) || t("tasks.untitled")` เป็นชื่อแถว และตรวจว่า `pages/task/model/items.ts` ไม่สร้างบรรทัดจาก `task.titled` (เพิ่ม test ถ้ามันไม่ข้ามเอง) ตรวจด้วย `bun run check` กับ `bun run test`

- [x] 3.3 ให้หัวหน้า Task วาง Character ติดปุ่มกลับและแสดงชื่อ Task ใต้ชื่อ Agent แทนสถานะ ตาม design ข้อ 8 (`titleOfEvents` ใน `entities/task`, `TaskTitle`, `TaskPage`) แล้วตรวจบน simulator ทั้งโหมดสว่างและมืด ว่าปุ่มกลับยังทำงาน และ Task ใหม่ยังเป็นหัวตรงกลาง

## 5. Member แก้ชื่อ

- [x] 5.1 Protocol: `task.rename { agent, title }` ใน `protocol-ts` (schema, ตาราง type, test) และ `packages/protocol/src/messages.rs` ตรวจด้วย `check:protocol`
- [x] 5.2 Runtime: `ToWorker::Retitle`, supervisor ส่งต่อ, worker ตรวจคนเริ่มแล้ว append `task.titled { title, member }`, การตั้งชื่ออัตโนมัติข้ามเมื่อมีชื่อแล้ว ตรวจด้วย test ใน `runtime-core`
- [x] 5.3 Controller: `renameTask` ใน machine-link และแก้ชื่อที่ชื่อบนแผ่นรายละเอียด ตรวจด้วย `bun run check` กับ `bun run test`
- [x] 5.4 ตรวจบน simulator ว่าแก้ชื่อจากทั้งสองทางแล้วหัวหน้า Task และแถวเปลี่ยนตาม

## 6. แผ่นรายละเอียดและ context แยกส่วน

- [x] 6.1 วาด board "Task: รายละเอียด" บน canvas ห้าแบบ
- [x] 6.2 Runtime: `parts` ใน `context.usage` พร้อม unit test
- [x] 6.3 Controller: `TaskDetailsPage`, `contextPartsOf`/`factsOf` พร้อม test, `EditableTitle` และ `PartsBar` ใน shared/ui, route `details` เป็น sheet ไม่มีหัว, กดค้างแถวและแตะหัวเปิดแผ่นนี้, ลบ slice `task-rename`
- [x] 6.4 ตรวจบน simulator ว่าแผ่นแสดง context แยกส่วนจาก Runtime จริง และทั้งสองทางเปิดแผ่นได้

## 4. เอกสารและตรวจในแอปจริง

- [x] 4.1 เพิ่มประโยคเรื่องชื่อในคำว่า **Task** ใน `CONTEXT.md` (Runtime ตั้งชื่อหลัง Turn แรกที่จบปกติ และชื่อเป็น event ใน log) ตรวจโดยอ่านแล้วไม่มีคำในรายการ _Avoid_
- [x] 4.2 รัน `bun run dev` แล้วเริ่ม Task ใหม่จาก Controller บน simulator ให้ Turn แรกจบ แล้วดูว่าแถวในหน้า Agent เปลี่ยนจากข้อความแรกเป็นชื่อ และไม่เปลี่ยนอีกหลังส่งข้อความที่สอง จากนั้นถ่ายภาพหน้าจอเก็บไว้ใส่ commit body
