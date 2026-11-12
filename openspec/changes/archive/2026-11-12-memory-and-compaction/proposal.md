## Why

Agent ยังจำข้าม Task ได้เฉพาะไฟล์ใน Workdir ที่ไม่มีใครรับประกันว่าจะถูกอ่าน v0.1 ต้องมี `MEMORY.md` ที่ Runtime ใส่เข้า prompt ทุก Task และมีเพดานชัดเจน เพื่อให้ Agent จดข้อตกลงที่ต้องรู้ทุกครั้งได้โดยไม่ทำให้ prompt บวม

## What Changes

- Runtime อ่าน `MEMORY.md` ที่ root ของ Workdir และใส่เข้า system prompt ของทุก Turn ใหม่
- เพดาน 4,000 ตัวอักษร; ถ้าเกินใส่ส่วนต้นและบอก Agent ให้ย่อ
- Memory ถูกตรึงตอนเริ่ม Turn; แก้กลาง Turn มีผล Turn ถัดไป
- คำสั่ง `veeloe memory <agent>` บน Machine แสดง Memory ที่ Turn ถัดไปเห็น พร้อมจำนวนตัวอักษรและที่อยู่ไฟล์
- การย่อ context เมื่อ token ถึง 70%: Runtime สรุปประวัติเก่าเป็น `context.compacted` และใช้ summary กับ request ถัดไป

## Capabilities

### New Capabilities

- `agent-memory`: `MEMORY.md` ที่ Runtime ใส่เข้า prompt และมีเพดาน

### Modified Capabilities

- `runtime-agents`: system prompt ต่อ Turn รวม Memory
- `runtime-cli`: คำสั่ง `veeloe memory` สำหรับอ่าน Memory ของ Agent

## Non-goals

- Full-text search Task เก่า (ADR 0036)
- Page ใน Controller สำหรับอ่าน Memory (ยังไม่ทำในรอบนี้; คำสั่งบน Machine พอสำหรับ v0.1)

## Impact

- **Runtime core:** `memory.rs`, `AgentCore::with_workdir`, system prompt
- **Worker:** ส่ง Workdir ให้ core
- **Runtime CLI:** `veeloe memory <agent>` อ่านอย่างเดียว ไม่แตะ Workdir
- **Controller/Protocol/Hub:** ไม่เปลี่ยนในรอบนี้

## Acceptance anchor cases

- มี `MEMORY.md` แล้ว Agent ใหม่ทุก Turn เห็นเนื้อหาใน system prompt
- ไฟล์เกิน 4,000 ตัวอักษรถูกตัดและมีข้อความบอกให้ย่อ
- ไม่มีไฟล์ = prompt เดิม
- แก้ `MEMORY.md` กลาง Turn ไม่กระทบ Turn ปัจจุบัน
- `veeloe memory <agent>` แสดงเนื้อหา จำนวนตัวอักษร และที่อยู่ไฟล์ โดยไม่สร้างโฟลเดอร์ใหม่
