## Why

`memory-and-compaction` ให้ Runtime ใส่ `MEMORY.md` เข้า prompt และมีเพดาน 4,000 ตัวอักษร แต่การเขียนยังพึ่ง file tools ที่ Agent ต้องเลือกใช้เอง ในทางปฏิบัติ Agent จึงสร้างที่จดของตัวเอง (โฟลเดอร์ `memory/owner.md`) แทน `MEMORY.md` เพราะ prompt บอกแค่ตอนที่มีไฟล์อยู่แล้ว และไม่มีจังหวะที่โค้ดบังคับให้จด

OpenClaw แก้ปัญหาเดียวกันด้วยการให้โค้ดคุมเส้นทางเขียนและจังหวะจด: tool เขียนที่รู้ที่อยู่, flush ก่อน compaction, และ consolidation เบื้องหลัง (ADR 0036, 0041 ของเราไม่ได้ห้ามสิ่งเหล่านี้ แต่ยังไม่มี)

## What Changes

- เพิ่ม tool `memory` ใน worker: `{ text, mode: "append"|"replace", scope: "long"|"today" }` เขียน `MEMORY.md` ที่ root ของ Workdir หรือ `memory/YYYY-MM-DD.md` ตามวันที่ของ Machine โดยบังคับเพดาน 4,000 ตัวอักษรกับ `MEMORY.md` และเขียนแบบ atomic
- ก่อน compaction สรุปประวัติ Runtime จะรัน turn เงียบที่ถามโมเดลว่า "มีอะไรควรจดถาวรไหม" แล้ว **โค้ดเป็นคนเขียน** ลง `MEMORY.md` ผ่านตัวเขียนเดียวกัน; ถ้าโมเดลตอบ `NO_REPLY` หรือพลาด/timeout จะข้ามโดยไม่กระทบคำตอบ
- บันทึก event `memory.saved` ตอน flush เขียนสำเร็จ (จำนวนตัวอักษร ไม่มีเนื้อหา) เพื่อให้ตรวจย้อนหลังได้
- ปรับข้อความ system prompt ให้บอกชื่อ tool และที่อยู่ของ Memory ทุก Turn
- daily note: `scope: "today"` เขียนไฟล์รายวันไว้ให้ Agent จดเรื่องที่ไม่ต้องรู้ทุก Task; การสรุปรายวันเข้า `MEMORY.md` ด้วย Schedule ยังรอ v0.2 (Schedule ยังไม่มีใน v0.1) — บันทึกเป็นงานถัดไป ไม่ทำใน change นี้

## Capabilities

### New Capabilities

- `agent-memory-writes`: tool เขียน Memory, flush ก่อน compaction และบันทึกรายวัน

### Modified Capabilities

- `agent-memory`: prompt บอกเส้นทางเขียน Memory และการเขียนต้องผ่านเพดานเดียวกัน

## Non-goals

- ไม่ทำ index/search ข้าม Task (ADR 0036 ยังคงเป็นงานถัดไป)
- ไม่ทำ provenance ระดับ OpenClaw (owner/untrusted/system) — v0.1 มี Owner คนเดียว
- ไม่ทำ dreaming/consolidation อัตโนมัติ; รอ Schedule ใน v0.2
- ไม่เปลี่ยนรูปแบบ `MEMORY.md` และไม่เปลี่ยนเพดาน 4,000 ตัวอักษร
- ไม่แตะ Controller, Protocol หรือ Hub

## Impact

- **Runtime core:** `memory.rs` (ตัวเขียน + เพดานร่วม), `agent.rs` (prompt, flush ก่อน compaction, event `memory.saved`)
- **Runtime worker:** `tools/memory.rs` ใหม่, `worker.rs` ลงทะเบียน tool
- **Protocol/Controller/Hub:** ไม่เปลี่ยน
- **Docs:** `docs/roadmap.md` (หมายเหตุงาน daily consolidation), change นี้

## Acceptance anchor cases

- Agent ถูกสั่ง "จำชื่อเล่นว่าเน็ก" แล้วเรียก tool `memory` → `MEMORY.md` มีชื่อนั้น และ Turn ถัดไปเห็นใน prompt
- เขียนจนเกิน 4,000 ตัวอักษร → tool ตอบ error `memory.too_long` และไฟล์ไม่เปลี่ยน
- ใกล้เต็ม context → Runtime flush ก่อนสรุป และ `MEMORY.md` มีข้อความที่โค้ดเขียน (ไม่ใช่ Agent เขียนเองโดยไม่มี tool)
- โมเดลตอบ `NO_REPLY` ตอน flush → ไม่มีไฟล์เปลี่ยน และ compaction ยังทำงานปกติ
- `scope: "today"` → เกิด `memory/YYYY-MM-DD.md` ตามวันที่ของ Machine และไม่กินเพดานของ `MEMORY.md`
