## Why

Task ยังไม่มีชื่อ หน้า Agent จึงใช้ข้อความล่าสุดเป็นชื่อแถวของแต่ละ Task (`previewOf`) ชื่อแถวเลยเปลี่ยนทุก Turn และพอ Agent ตอบท้าย Turn ว่า "เสร็จแล้วครับ" Owner ก็ดูไม่ออกว่า Task นั้นคุยเรื่องอะไร ต้องกดเข้าไปอ่านทีละอัน

## What Changes

- **Runtime ตั้งชื่อ Task:** เมื่อ Turn แรกของ Task จบแบบ `done` harness จะเรียก LLM เพิ่มอีกหนึ่งครั้ง โดยไม่มี tool และใช้ข้อความแรกของ Member กับคำตอบแรกของ Agent ให้ LLM ตั้งชื่อสั้น ๆ ในภาษาเดียวกับ Member แล้วบันทึกเป็น event ใหม่ `task.titled { title }` ใน log ถ้าตั้งชื่อไม่สำเร็จ Task ก็ไม่มีชื่อ และ Turn ไม่ล้มเหลวเพราะเรื่องนี้
- **ชื่อไปกับ event เดิม:** `task.titled` เดินทางไปถึง Controller แบบเดียวกับ event อื่นของ Task Protocol ไม่ต้องมีชนิดซองใหม่ และ Hub ไม่เห็นชื่อ
- **Controller แสดงชื่อ:** แถว Task ในหน้า Agent ใช้ `task.titled` ล่าสุดเป็นชื่อ ถ้ายังไม่มีก็ใช้บรรทัดแรกของข้อความแรกของ Member ชื่อนี้จึงไม่เปลี่ยนตาม Turn ส่วนแถวใน Inbox ยังคงแสดงข้อความล่าสุดเหมือนเดิม
- **หัวหน้า Task แสดงชื่อ:** Character ย้ายไปติดปุ่มกลับทางซ้าย และบรรทัดใต้ชื่อ Agent เป็นชื่อ Task แทนสถานะ
- **แผ่นรายละเอียด Task:** กดค้างแถวในหน้า Agent หรือแตะหัวหน้า Task เปิดแผ่นที่มีชื่อ (แตะแก้ได้) สถานะ ปุ่มหยุด context แยกส่วน รายละเอียด และไฟล์
- **Member แก้ชื่อได้:** แตะชื่อบนแผ่นรายละเอียด Controller ส่งคำสั่งใหม่ `task.rename` และ Runtime เก็บเป็น `task.titled` ที่มี `member` Runtime ไม่ตั้งชื่อทับชื่อที่มีอยู่แล้ว

## Capabilities

### New Capabilities

- `task-title`: Runtime ตั้งชื่อ Task หลัง Turn แรก และ Controller แสดงชื่อนั้นในรายการ Task ของหน้า Agent

### Modified Capabilities

- `task-log`: เพิ่ม `task.titled` ในรายการ event ที่ log เก็บ

## Impact

- `packages/runtime/crates/runtime-core/src/agent.rs`: เรียก LLM ตั้งชื่อหลัง Turn แรกจบ แล้ว append `task.titled`
- `packages/protocol-ts/src/messages/task.ts`: เพิ่มชื่อ kind `task.titled` แยกจาก `TaskEventKind` เพราะ `TaskEventKind` คือชุดที่ใช้คิดสถานะ
- `controller/src/entities/task/model/tasks.ts`: `LIST_TASK_SUMMARIES` ดึงชื่อกับข้อความแรก และมี `titleOf`
- `controller/src/pages/agent/ui/AgentPage.tsx`: ชื่อแถวของ Task
- `controller/src/pages/task/ui/TaskPage.tsx` กับ `TaskTitle.tsx`: หัวหน้า Task
- Budget: การตั้งชื่อใช้ token เพิ่ม Task ละหนึ่งคำขอสั้น ๆ และนับเข้า Budget ของ Agent (ADR 0043)
- `CONTEXT.md`: เพิ่มเรื่องชื่อไว้ในคำว่า Task
