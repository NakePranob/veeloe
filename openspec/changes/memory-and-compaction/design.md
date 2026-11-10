## Context

- `AgentCore` สร้าง system prompt ใน `message()` จากชื่อ Agent เท่านั้น
- `runtime-worker` มี `Config.dir` = `<home>/agents/<id>`; Workdir คือ `dir/workdir`
- ยังไม่มี Memory หรือ compaction

## Decisions

### 1. Memory อยู่ที่ Workdir root และ Runtime อ่านเอง

**Decision:** `MEMORY.md` ที่ `workdir/MEMORY.md`; Runtime อ่านตอนเริ่ม Turn และใส่ใน system prompt

**Why:** Agent แก้ได้ด้วย file tools เดิม; ไม่ต้องมี tool ใหม่; prompt cache ไม่เสียกลาง Turn

### 2. เพดาน 4,000 ตัวอักษร

**Decision:** ตัดที่ 4,000 chars และต่อท้ายด้วยข้อความให้ย่อ; ไม่ตัดกลาง grapheme

**Why:** ตัวอักษรนับได้ทุก Provider โดยไม่ต้อง tokenizer; เผื่อภาษาไทย

### 3. ตรึงตอนเริ่ม Turn

**Decision:** อ่าน Memory ครั้งเดียวตอนสร้าง system prompt; การแก้ระหว่าง Turn เห็นTurn ถัดไป

**Why:** กัน prompt เปลี่ยนกลางเทิร์นและทำ cache เสีย

### 4. Compaction ยังไม่ทำในรอบนี้

**Decision:** เก็บ ADR 0041 ไว้เป็นงานถัดไป; change นี้ส่ง Memory ก่อน

**Why:** Compaction ต้องเรียก LLM สรุปและจัดการ tool round; เป็นงานแยกที่ต้องทดสอบกับ Provider จริง

## Risks

- Memory อาจมีคำสั่งที่ถูกวางยา; file tools และหน้า Task แสดงการแก้ไข แต่ยังไม่มี UI อ่าน Memory
- 4,000 chars อาจไม่พอสำหรับบาง Agent; ยังตั้งต่อ Agent ไม่ได้
