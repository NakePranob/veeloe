## 1. Runtime core: ตัวเขียน Memory

- [x] 1.1 เพิ่มใน `runtime-core/src/memory.rs`: `MEMORY_FILE`, `Mode` (`append`/`replace`), `MemoryWriteError` (`TooLong`, `Io`, `Bad`, `Stopped`), `write_memory(workdir, text, mode)` ที่อ่านของเดิม รวมตาม mode ตรวจเพดาน 4,000 ตัวอักษร แล้วเขียนแบบ atomic (temp + rename, สิทธิ์ 0600) พร้อม test: append ต่อท้าย, replace แทนทั้งไฟล์, เกินเพดานปฏิเสธและไฟล์เดิมไม่เปลี่ยน, ไฟล์หายสร้างใหม่
- [x] 1.2 เพิ่ม `daily_note_path(workdir, date)` และ `append_daily_note(workdir, date, text)` ที่สร้างโฟลเดอร์ `memory/` และเขียนต่อท้ายไฟล์วัน; test ว่าเขียนสองครั้งต่อกันได้และไม่แตะ `MEMORY.md`
- [x] 1.3 ตรวจ `cargo test -p veeloe-runtime-core --lib memory -- --test-threads=1`

## 2. Runtime worker: tool `memory`

- [x] 2.1 เพิ่ม `runtime-worker/src/tools/memory.rs` (`MemoryTool`): tool name `memory`, schema `{ text, mode, scope }`, ใช้ `write_memory`/`append_daily_note` จาก core, ตอบจำนวนตัวอักษรและเพดาน, แปลง error เป็น `ToolError::Failed("memory.too_long: …")`; รับ clock สำหรับ test
- [x] 2.2 ลงทะเบียน `MemoryTool` ใน `worker.rs` หลัง `FileTools` (worker อ่าน–เขียน workdir เดียวกัน) และอัปเดต doc comment ของ `tools/mod.rs`
- [x] 2.3 เพิ่ม test: append สร้างไฟล์, append สองครั้งต่อกัน, เกินเพดานได้ error และไฟล์ไม่เปลี่ยน, replace, scope today สร้าง `memory/<date>.md`
- [x] 2.4 ตรวจ `cargo test -p veeloe-runtime-worker --test tools -- --test-threads=1`

## 3. Runtime core: flush ก่อน compaction

- [x] 3.1 เพิ่ม `flush_memory_before_compaction(state, task, transcript)` ใน `agent.rs`: ขอ LLM คำตอบสั้น (system บอกว่าจดเฉพาะสิ่งถาวร, ห้ามซ้ำของเดิม, ตอบ `NO_REPLY` ถ้าไม่มี), ไม่มี tool, timeout ตามปกติ; ถ้าได้ข้อความให้ `write_memory(..., append)`; บันทึก `memory.saved` ที่ `{chars}`; ทุก error ข้ามเงียบ ๆ
- [x] 3.2 เรียก flush ใน `compact_if_needed()` ก่อนสร้าง summary (หลังตรวจว่า transcript ไม่ว่าง) และอย่าให้ flush ทำให้ `compacted` หาย
- [x] 3.3 อัปเดตข้อความ system prompt ใน `agent.rs` ให้บอก tool `memory`, ที่อยู่ `MEMORY.md` และ `scope: "today"`
- [x] 3.4 เพิ่ม test ใน `runtime-core/tests/agent.rs`: flush เขียน MEMORY.md และมี event, `NO_REPLY` ไม่เขียนแต่ compaction ยังเกิด, flush error ไม่ทำให้ Turn ล้มเหลว, prompt มีชื่อ tool

## 4. ตรวจและปิด change

- [x] 4.1 ตรวจ `bun run check:runtime` ผ่านทั้ง workspace
- [ ] 4.2 ทดลองจริงบน Agent ในแอป: สั่งให้จำชื่อเล่น → `veeloe memory <agent>` เห็นข้อความ; เขียนเกินเพดาน → ได้ `memory.too_long` (ยังไม่ได้รันกับโมเดลจริง; ปิดด้วย test แทน)
- [x] 4.3 อัปเดต `docs/roadmap.md` ว่าการสรุป daily note เข้า `MEMORY.md` รอ Schedule ใน v0.2
- [x] 4.4 ตรวจ `bun run check` ทั้งชุด แล้ว archive change พร้อม merge spec deltas เข้า `openspec/specs/`
- [x] 4.5 แก้ตาม reviewer: date validator ต้องเป็น `-` ที่ตำแหน่ง 4/7, กัน symlink ออกจาก Workdir, เพิ่ม `memory` ใน `FILE_TOOL_NAMES`, จับ `NO_REPLY` ที่บรรทัดแรก, ตัดคำตอบ flush ที่ 400 ตัวอักษร, temp file ไม่ซ้ำ, ปฏิเสธ `replace` กับ `today`, เพิ่ม test ป้องกันการ flush ซ้ำ/ลำดับ event/ขนาดวัน
