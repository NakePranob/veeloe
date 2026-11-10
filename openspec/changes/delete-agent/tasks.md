## 1. Protocol

- [x] 1.1 เพิ่ม `AgentDeleteBodySchema` (`{ id }`) ใน `packages/protocol-ts/src/messages/agent.ts`, export จาก index, เพิ่มใน `messages/index.ts` และ Rust `messages.rs` (`is_agent_delete`, `message_is_valid`)
- [x] 1.2 เพิ่ม test ว่า `agent.delete` ที่มี id ถูกอ่าน, ไม่มี id ถูกปฏิเสธ, และ id ที่ไม่ใช่ folder name ถูกปฏิเสธ

## 2. Runtime

- [x] 2.1 เพิ่ม `Workers::stop(&self, id)` ที่เอา entry ออกจาก running และปล่อยให้ worker จบ; test ว่า agent ที่หยุดแล้วไม่รับ frame ใหม่
- [x] 2.2 เพิ่ม `TaskRoutes::forget(&self, agent)` ที่ลบ pin ของ Agent และเขียนไฟล์; test ว่า route ของ Agent อื่นยังอยู่
- [x] 2.3 เพิ่ม `agent.delete` ใน `dispatch`: authorize Manage/owner, ตรวจ Agent มีอยู่, stop worker, registry.remove, routes.forget, แล้วตอบ `agent.listed`
- [x] 2.4 เพิ่ม `routes` เข้า `Machine` (optional สำหรับ test) และ wire `TaskRoutes` ใน `main.rs`; test ว่า delete แล้ว `registry.all` ไม่มี Agent และ Workdir ยังอยู่

## 3. Controller

- [x] 3.1 เพิ่ม `deleteAgent(machine, id)` ใน `features/machine-link` ที่ส่ง `agent.delete`; test ว่า frame มี type/body ถูกต้อง
- [x] 3.2 เพิ่มปุ่มลบใน `AgentPage` พร้อม confirm, เตือนว่า Turn ที่กำลังทำจะจบและ Workdir/Task ยังอยู่, และยืนยันตัวใหม่; ปิดปุ่มเมื่อ offline/ไม่มี Manage
- [x] 3.3 แก้ `saveAgents` ให้ลบแถวของ Machine ที่ไม่อยู่ใน `agent.listed` แล้ว; test ว่า Agent ที่ลบหายจาก local
- [x] 3.4 เพิ่ม i18n th/en สำหรับ delete, confirm, warning, failed
- [x] 3.5 ตรวจหน้า Task ที่อ้าง Agent ที่ถูกลบไม่ crash

## 4. ตรวจ

- [x] 4.1 `bun run check:protocol`
- [x] 4.2 `cd packages/runtime && cargo test -p veeloe-runtime-supervisor`
- [x] 4.3 `cd controller && bun test ./src`
- [x] 4.4 `bun run check:controller`
- [ ] 4.5 ลบ Agent จริงบน iOS/Android; ตรวจว่าหายจากรายการ, Workdir ยังอยู่, Task เดิมเปิดได้
