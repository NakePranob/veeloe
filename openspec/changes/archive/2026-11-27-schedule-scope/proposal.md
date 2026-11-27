## Why

รอบของ Schedule ที่ถึงเวลาเองไม่มีใครเฝ้าอยู่ แต่ตอนนี้ยังขอ Approval ตามปกติ คำขอจึงค้างจนหมดอายุ (ค่าเริ่มต้น 1 ชั่วโมง) ระหว่างนั้น Agent ไม่ว่าง รอบถัดไปจึงถูกข้ามแบบเงียบๆ และ Task ที่คนพิมพ์เองก็ต้องรอ สุดท้ายคำขอก็ถูกนับว่าปฏิเสธอยู่ดี ADR 0079 จึงย้ายการอนุมัติไปไว้ตอนตั้ง Schedule ส่วนการ์ดของ Schedule ตอนนี้ไม่บอกว่ารอบล่าสุดถูกข้ามหรือไม่

## What Changes

- `trigger.set` มี `allow` (ไม่บังคับ) เป็นรายการแบบเดียวกับ Allowlist คือ scope ที่รอบของ Schedule นี้ทำได้โดยไม่ต้องขอ Approval scope ที่ไม่ว่างต้องเซ็นโดยคนที่มี Approve
- รอบที่ถึงเวลาเองไม่ขอ Approval ทั้งคำสั่ง tool และโดเมน สิ่งที่อยู่นอก Allowlist และ scope ถูกปฏิเสธทันที บันทึกเป็น event `approval.skipped` และรอบนั้นจบแบบ quiet ไม่ได้
- รอบจาก `trigger.run` มีคนเฝ้า (`trigger.attended`) จึงขอ Approval ตามปกติ
- `trigger.listed` ส่ง `allow` และ `lastSkip` (`at`, `why`) มาด้วย
- `trigger.set` ที่แทน Schedule เดิมโดยเวลาไม่เปลี่ยน รักษารอบเดิมไว้
- Controller: การ์ด Schedule แสดงรอบล่าสุดและ scope และลบรายการออกจาก scope ได้ Task ของรอบแสดงสิ่งที่ถูกปฏิเสธ พร้อมปุ่ม "ให้ Schedule นี้ทำได้เลย" Approval ในรอบที่กด "รันเลย" มีปุ่มเดียวกัน

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `triggers`: scope ของ Schedule, รอบที่ไม่มีคนเฝ้า และรอบที่ข้ามล่าสุด
- `controller-schedules`: รอบล่าสุด scope และปุ่มเพิ่มเข้า scope

## Impact

- **Protocol:** `packages/protocol/src/messages.rs`, `packages/protocol-ts/src/messages/trigger.ts` และ `task.ts`, vectors
- **Runtime:** `runtime-core` (`TriggerRun`, `run_tool`, quiet), supervisor (`triggers.rs`, `messages/trigger.rs`, `approval.rs`, `main.rs`)
- **Controller:** `pages/agent-schedule`, `pages/task`, `features/machine-link`
- **Docs:** ADR 0079, ADR 0027, `CONTEXT.md`
