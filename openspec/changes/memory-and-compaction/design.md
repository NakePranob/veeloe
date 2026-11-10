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

### 4. Compaction สรุปทั้งก้อนก่อน 70% ของ context

**Decision:** ก่อน request ทุกครั้ง ประเมิน token แบบหยาบ; ถ้าถึง 70% และไม่ได้อยู่กลาง tool round ให้เรียก LLM สรุปประวัติก่อน `member.message` ล่าสุด เก็บ `context.compacted` แล้วใช้ summary + ข้อความหลังจุดนั้น

**Why:** ADR 0041 ต้องการ summary ทั้งก้อนและไม่แตะ result ของ tool ที่ยังค้าง; ประวัติเต็มยังอยู่ใน event log

### 5. Context window มาจาก Provider model list ก่อน

**Decision:** อ่าน `context_window`, `context_length`, `max_context_length`, `max_input_tokens`, `input_token_limit` หรือ `top_provider.context_length` จาก model list; ถ้าไม่มีใช้ 128K และแสดงว่าเป็นค่าประมาณ

**Why:** Provider ไม่มีมาตรฐานเดียวกัน; การเดาจากชื่อ model เปราะและล้าสมัย

**Open:** Owner override ต่อ model ในหน้า Provider (งานถัดไป)

## Risks

- Memory อาจมีคำสั่งที่ถูกวางยา; file tools และหน้า Task แสดงการแก้ไข แต่ยังไม่มี UI อ่าน Memory
- 4,000 chars อาจไม่พอสำหรับบาง Agent; ยังตั้งต่อ Agent ไม่ได้
