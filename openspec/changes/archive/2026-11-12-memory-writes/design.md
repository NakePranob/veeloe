## Context

- `packages/runtime/crates/runtime-core/src/memory.rs` — `MEMORY_LIMIT`, `Memory`, `read_memory`, `memory_prompt` (ตัวอ่านตัวเดียว)
- `packages/runtime/crates/runtime-core/src/agent.rs` — system prompt ต่อ Turn, `compact_if_needed()`, `LlmRequest`
- `packages/runtime/crates/runtime-worker/src/tools/files.rs` — `FileTools` (`read`, `write`, `edit`, `glob`, `grep`) และรูปแบบ `ToolRunner`/`ToolDefinition`
- `packages/runtime/crates/runtime-worker/src/worker.rs` — ที่ลงทะเบียน `BashTool` และ `FileTools`
- `packages/runtime/crates/plugin-api/src/lib.rs` — `ToolDefinition`, `ToolError`, `ToolRunner`
- `docs/adr/0036-*.md` — Memory คือ `MEMORY.md`, Agent เขียนเองด้วย file tools, แอปอ่านได้
- `docs/adr/0041-*.md` — compaction ที่ 70% ของ context window

## Terminology

- **Memory tool** คือ tool `memory` ที่ Runtime ให้ worker ใช้เขียน Memory; ไม่ใช่ file tool ทั่วไป
- **Flush** คือ turn เงียบก่อน compaction ที่ถามโมเดลว่ามีอะไรควรจด แล้ว **โค้ดเขียนเอง**
- **Daily note** คือ `memory/YYYY-MM-DD.md` ใต้ Workdir ตามวันที่ของ Machine
- **Cap** คือ 4,000 ตัวอักษรของ `MEMORY.md` (นับ Unicode scalar)

## Decisions

### 1. tool `memory` เป็นทางเขียนที่โค้ดคุมที่อยู่ ไม่ใช่ blocking file tools

**Decision:** เพิ่ม tool `memory` ที่รับ `{ text, mode, scope }`; `scope: "long"` เขียน `MEMORY.md` ที่ root, `scope: "today"` เขียน `memory/<วันที่>.md`; `mode` เป็น `append` (ค่าเริ่มต้น) หรือ `replace`; tool บังคับ Cap และเขียนแบบ atomic

**Why:** ADR 0036 ให้ Agent เขียน Memory ได้เอง แต่ปล่อยให้เลือก path เองแล้วได้ผลไม่แน่นอน (เกิด `memory/owner.md`); tool ทำให้ที่อยู่, การรวมบรรทัด และเพดานเป็นเรื่องของโค้ด ขณะที่เนื้อหายังเป็น judgment ของโมเดล tool ถูกเพิ่มใน `FILE_TOOL_NAMES` ของ `agent.rs` เพื่อให้เขียนได้โดยไม่ต้องขอ Approval ทุกครั้ง เหมือน file tools อื่น (ADR 0030) เพราะ path ถูกจำกัดใน Workdir แล้ว และ `write_memory` ตรวจ symlink ไม่ให้เขียนออกนอก Workdir

**Rejected:** ห้าม file tools แตะ `MEMORY.md` — ผิด ADR 0036 ที่ให้ Agent แก้ไฟล์เองได้ และทำให้ tool เก่าที่มีอยู่พังโดยไม่จำเป็น; การเขียนตรงยังได้ผลตามปกติ แต่ไม่มี Cap ระดับ tool (prompt ยังตัดตอน inject)

**Rejected:** ให้ tool เขียนไฟล์ชื่ออื่นแล้ว Runtime รวมให้ — เพิ่มขั้นตอนและทำให้ผู้ใช้อ่านไฟล์จริงไม่ตรงกับ prompt

### 2. Cap บังคับที่ tool และใช้ตัวเขียนร่วมใน core

**Decision:** `append` ที่ทำให้เกิน Cap ตอบ `memory.too_long` พร้อมจำนวนตัวอักษรปัจจุบันและที่เกิน; `replace` ที่เกินก็ปฏิเสธ; ตัวเขียนอยู่ใน `runtime-core::memory` และใช้ร่วมกับ flush

**Why:** ถ้าตัดให้เงียบ ๆ เนื้อหาท้ายไฟล์จะหายโดยไม่มีใครรู้; การปฏิเสธทำให้ Agent ต้องย่อเอง (ตรงกับข้อความให้ย่อที่ prompt เห็น) และมีที่เดียวที่รู้กฎ Cap

### 3. Flush ก่อน compaction เป็น turn เงียบที่โค้ดเขียนผลลัพธ์

**Decision:** ก่อนสร้าง summary ของ compaction ถ้า transcript ไม่ว่าง ให้เรียก LLM หนึ่งครั้งพร้อม system prompt "จดเฉพาะสิ่งถาวร", ไม่มี tool, ขอคำตอบสั้น ๆ หรือ `NO_REPLY`; ถ้าได้ข้อความ โค้ดจะ `append` ลง `MEMORY.md` ผ่านตัวเขียนเดียวกับ tool แล้วบันทึก event `memory.saved` ที่มีแค่จำนวนตัวอักษร

**Why:** OpenClaw ใช้วิธีเดียวกัน (silent flush ก่อน compaction) เพราะจังหวะนี้คือจุดที่บริบทกำลังจะหาย; การให้โค้ดเขียนแทน tool round ทำให้สั้น ตรวจง่าย และไม่ปนเข้า Task log ในฐานะข้อความของผู้ใช้

**Rejected:** ให้ flush เรียก tool ผ่าน tool round — ต้องมีหลาย request, จัดการ tool_use/result ในประวัติ และมีโอกาสค้างกลางทาง; ผลลัพธ์ที่ต้องการคือข้อความสั้น ๆ อยู่แล้ว

**Rejected:** ให้โมเดลเขียนเองด้วย `write` ใน flush — กลับไปพึ่ง path ที่ผิดอีก

### 4. Flush ล้มเหลวต้องไม่กระทบคำตอบ

**Decision:** timeout/error/`NO_REPLY`/ข้อความว่าง → ข้าม flush แล้วทำ compaction ต่อ; การเขียนไฟล์ล้มเหลวก็ข้าม; ไม่มี retry ในเทิร์นนั้น

**Why:** หลักเดียวกับ OpenClaw ("failures never block replies") และ ADR 0017/0033 ที่ Stop ต้องไม่ค้าง

### 5. Daily note เขียนได้แล้ว แต่ consolidation รอ Schedule

**Decision:** `scope: "today"` เขียน `memory/<YYYY-MM-DD>.md` (วันที่ตาม local time ของ Machine) โดยไม่มี Cap เท่า `MEMORY.md`; การสรุป daily note เข้า `MEMORY.md` จะทำเมื่อมี Schedule (v0.2 ตาม ADR 0027) และบันทึกไว้ใน roadmap

**Why:** เก็บของที่ยังไม่ต้องรู้ทุก Task ได้ก่อน โดยไม่กินเพดาน; การสรุปอัตโนมัติต้องมีตัวตั้งเวลาและโมเดล ซึ่งเป็นขอบเขตของ Schedule ไม่ใช่ change นี้

## Risks

- Flush เพิ่ม LLM call หนึ่งครั้งต่อการ compact หนึ่งครั้ง; ถ้า Provider ช้า จะทำให้ Turn ยาวขึ้น — ยอมรับได้เพราะเกิดเฉพาะตอนใกล้เต็ม และมี timeout
- Agent ยังใช้ `write` เขียน `MEMORY.md` ตรงได้ (ADR 0036); Cap ยังถูกบังคับตอน inject เท่านั้น — tool เป็นทางที่แนะนำ ไม่ใช่กำแพง
- Daily note ไม่มี Cap และไม่ถูก index; ถ้า Agent จดเยอะจะกินดิสก์ — v0.1 ยอมรับ และ Schedule ใน v0.2 จะเป็นที่ย่อ/ย้าย
- วันที่ของ daily note ใช้ local time ของ Machine; เครื่องที่เปลี่ยนเขตเวลาจะได้ชื่อไฟล์ตามเวลาท้องถิ่น ซึ่งตรงกับ Budget day
