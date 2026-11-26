# Tasks

## 1. Protocol

- [x] 1.1 เพิ่ม `task.stop` (agent, id) ใน `packages/protocol` พร้อม `TaskStopBodySchema` และลงทะเบียนใน `parseMessage` ตรวจด้วย `bun test`
- [x] 1.2 เพิ่ม `turn.stopped` กับ `turn.interrupted` ใน `TaskEventKind` และทดสอบว่า schema ของ event ใหม่ผ่าน ตรวจด้วย `bun test`

## 2. worker หยุด Turn

- [x] 2.1 ส่ง `AbortSignal` ผ่าน `Llm.send` และ `ToolRunner.run` แล้วให้ `bashTool` ฆ่า process group พร้อมบอกว่า "stopped by the owner" ตรวจด้วย `bun test` ของ `bash.test.ts`
- [x] 2.2 `ipcFetch` รับ signal แล้ว reject คำขอที่ค้างเมื่อ abort และทิ้งคำตอบที่มาทีหลัง ตรวจด้วย `bun test`
- [x] 2.3 `createAgentCore` รับ `stop` เขียน `turn.stopped` + `turn.ended {reason:"stopped"}` ปลดการรอ Approval และปฏิเสธ `turn.not_running`/ส่งซ้ำด้วย `id` เดิม ตรวจด้วย flow test หยุด–จบ–คุยต่อ

## 3. ปิด Turn ที่ค้างตอนเริ่ม

- [x] 3.1 เพิ่ม `openTurns()` ใน `EventStore` (SQL ของ `turn.started` ตัวสุดท้าย) พร้อม test กับ `sqlite-store`
- [x] 3.2 worker ปิด Turn ที่ค้างทุกตัวตอนเริ่มด้วย `turn.interrupted` + `turn.ended {reason:"interrupted"}` และไม่ทำให้คำสั่งใหม่ถูกปฏิเสธ ตรวจด้วย test ที่สร้าง log ค้างแล้วเริ่ม core ใหม่

## 4. supervisor ส่งต่อ Stop

- [x] 4.1 เพิ่ม slice ของ `task.stop` ที่ตรวจ Agent กับสิทธิ์ Use แล้วส่ง `{ kind: "stop" }` ผ่าน IPC พร้อม `turn.not_running` เมื่อ worker ไม่มี Turn นั้น ตรวจด้วย test ของ slice

## 5. Controller

- [x] 5.1 ปุ่มหยุดในช่องพิมพ์ (เมื่อว่างและ Turn กำลังทำ) พร้อมกล่องยืนยันแบบทำลายที่บอกว่าจะหยุดอะไร และสถานะกำลังหยุด/error ตาม prototype ตรวจด้วย `bun run check` และ `check-i18n`
- [x] 5.2 บรรทัด "{{member}} หยุด Turn นี้" สำหรับ `turn.stopped` และการ์ด Turn ถูกขัดจังหวะพร้อมปุ่มทำต่อสำหรับ `turn.interrupted` ตรวจด้วย test ของ `items()` และ `bun run check`
- [x] 5.3 สถานะ `interrupted` ("Turn ถูกขัดจังหวะ") ใน Inbox และหัว Task พร้อม sort ให้อยู่กับงานที่กำลังทำ ตรวจด้วย test ของ `statusOf`/`inboxRows`

## 6. e2e

- [x] 6.1 e2e: กด Stop จาก Controller ระหว่างคำสั่งที่ค้าง แล้ว Turn จบด้วย `stopped` และไม่มีโปรเซสค้าง ตรวจด้วย `bun run test:e2e`

## Workflow follow-up

- ส่ง `reviewer` ตรวจ diff แบบ read-only ก่อนสรุป
- Archive change แล้วติ๊ก `stop-and-restart` ใน `docs/roadmap.md` ใน commit เดียวกัน
