## 1. Protocol

- [x] 1.1 เพิ่ม `push.register`, `push.registered`, `push.unregister`, `push.unregistered` ใน `packages/protocol-ts/src/messages` และ `packages/protocol/src/messages.rs` พร้อม validation ของ token/ภาษา; ตรวจด้วย `bun run check:protocol`
- [x] 1.2 เพิ่ม fixture ของข้อความใหม่ใน `packages/protocol/vectors/messages.json` และให้ทั้ง Rust/TypeScript อ่านตรงกัน; ตรวจด้วย `bun run check:protocol`

## 2. Runtime

- [x] 2.1 เพิ่ม Token Store ใต้ Runtime home ต่อ Member ต่อกุญแจ Controller พร้อมภาษาและเวลา; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor push_tokens`
- [ ] 2.2 รับ `push.register`/`push.unregister` ใน `dispatch`; ลงทะเบียนซ้ำเขียนทับ record เดิม และตอบ ack/error; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor`
- [ ] 2.3 ลบ Token Record เมื่อกุญแจ Controller ถูกถอน; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor`
- [x] 2.4 เพิ่ม Expo Push client ที่ส่ง Generic Push ตามภาษา และลบ token เมื่อ Expo ตอบ `DeviceNotRegistered`; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor push::`
- [ ] 2.5 ส่ง push เมื่อ `approval.requested` ถึงคนที่มี Approve ที่ Agent; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor`
- [ ] 2.6 ส่ง push เมื่อ `turn.ended` ถึง Member ที่เริ่ม Turn เท่านั้น; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor`

## 3. Controller

- [x] 3.1 ติดตั้ง `expo-notifications`, ขออนุญาตหลังผูก Machine/สร้าง Agent ครั้งแรก และขอ token; ตรวจด้วย `bunx tsc --noEmit`
- [x] 3.2 ส่ง `push.register` พร้อมภาษาทุกครั้งที่เชื่อม Machine และเก็บ token ไว้ลงทะเบียนใหม่; ตรวจด้วย `bun test ./src ./scripts`
- [ ] 3.3 เพิ่มสวิตช์เปิด/ปิด notification ของเครื่องนี้; ปิดแล้วส่ง `push.unregister`; ตรวจด้วย `bun test ./src ./scripts`
- [x] 3.4 จัดการ foreground: ไม่แสดง banner เมื่อเปิด Active Task เดียวกัน และกด push แล้วเปิด Task/Approval ที่ถูกต้อง; ตรวจด้วย `bun run check:controller`

## 4. ตรวจ

- [ ] 4.1 `bun run check` ผ่าน
- [ ] 4.2 `bun run test` ผ่าน
- [ ] 4.3 QA บน iPhone จริง: อนุญาต notification, สร้าง Approval, เห็น Generic Push และกดแล้วเปิด Task
- [ ] 4.4 QA บน Android จริง: เหมือน 4.3 และตรวจว่าปิด notification แล้วไม่ได้รับ push
- [ ] 4.5 ตรวจว่าเนื้อหา push ไม่มีข้อความ Task ชื่อไฟล์ หรือชื่อ Agent และถอนกุญแจแล้ว token ใช้ไม่ได้
