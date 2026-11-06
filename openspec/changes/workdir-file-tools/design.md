# Design

## Context

- worker รันอยู่ใน sandbox ของ OS ทั้งโปรเซส (ADR 0008) และมี Workdir ของ Agent เป็นโฟลเดอร์ทำงาน (ADR 0032) tool `bash` ใน `worker/adapters/bash.ts` ใช้ `ToolRunner` จาก `worker/core/ports.ts` และรันคำสั่งใน Workdir; tool ทุกตัวจะอยู่ใต้กฎ sandbox เดียวกัน
- `ToolRunner` มีแค่ `definitions()` กับ `run(name, input)` และ error ที่ throw จะกลายเป็น `tool_result` ที่ `is_error` ให้ LLM อ่าน (ดู `worker/core/agent.ts`) จึงไม่ต้องมีช่องทาง error ใหม่
- ADR 0011 ให้ Subagent อนาคตมีแค่ `read`, `glob` และ `grep`; ชุด tool จึงต้องแยกโหมดอ่านอย่างเดียวได้โดยไม่ต้องมี implementation ที่สอง
- sandbox อนุญาตให้ worker อ่านไฟล์อื่นบนเครื่องได้ตาม ADR 0008 (ยกเว้นไฟล์ลับ) แต่ roadmap กำหนด file tools ไว้ว่าเป็น tool ใน Workdir — tool จึงจำกัด path เองอีกชั้น ไม่ได้พึ่ง sandbox อย่างเดียว

## Goals / Non-Goals

**Goals:**
- Agent อ่าน เขียน แก้ และค้นไฟล์ได้ในหนึ่ง tool call โดยไม่ต้องประกอบ shell
- path ทุกทางอยู่ใน Workdir และปฏิเสธ symlink ที่ออกนอก แม้ sandbox จะอนุญาต
- ชุดเดียวกันใช้กับ Subagent แบบอ่านอย่างเดียวได้

**Non-Goals:**
- อ่านนอก Workdir, rename/delete/move, patch หลายไฟล์, diff viewer
- Approval สำหรับการเขียนไฟล์ (change `approval-and-allowlist`)
- ล็อกไฟล์ข้ามโปรเซส — ADR 0011 ให้ Agent ทำทีละ Turn

## Decisions

### จำกัด path ที่ชั้น tool

สร้าง `worker/adapters/files.ts` ที่มี `resolveInWorkdir(workdir, input)`:

- path relative ต่อกับ Workdir; absolute ใช้ได้เฉพาะเมื่ออยู่ข้างใน
- ใช้ `realpath` ของโฟลเดอร์พ่อ (และของไฟล์ถ้ามี) แล้วเทียบว่าไม่หลุดออกจาก `realpath(workdir)` ด้วย `path.relative` ที่ไม่ขึ้นต้นด้วย `..` และไม่ใช่ absolute
- ไฟล์ที่มีอยู่และเป็น symlink: `realpath` ปลายทางต้องอยู่ใน Workdir ไม่งั้นปฏิเสธ
- ไฟล์ใหม่: ตรวจโฟลเดอร์พ่อที่ realpath แล้ว; ชื่อไฟล์ต้องไม่มี `..` หรือ separator แปลก
- ทุก error เป็น `Error` ธรรมดาเพื่อให้ agent core แปลงเป็น tool error

ทางเลือกที่ตัดออก: ปล่อยให้ sandbox เป็นคนเดียวที่ตรวจ (sandbox อนุญาตอ่านนอก Workdir จึงไม่ตรงกับสัญญาของ tool), ใช้ `chroot`/`openat2` (เกินจำเป็นและไม่พอร์ตทุก OS)

### `read`

คืนข้อความที่มีเลขบรรทัด `N\t<บรรทัด>` เริ่มที่ 1 เหมือน `cat -n` เพื่อให้ `edit` ใช้ข้อความที่เห็นได้

- `offset` เป็นบรรทัดเริ่ม (1-based, ค่าเริ่มต้น 1), `limit` จำนวนบรรทัด (ค่าเริ่มต้น 2,000)
- อ่านไฟล์ได้ไม่เกิน 10MB (ใหญ่กว่านั้นปฏิเสธให้ใช้ `grep`/`bash`) และตัดผลลัพธ์ที่ 256KB พร้อมบอกจำนวนบรรทัดที่เหลือ
- ตรวจ NUL ไบต์ใน 8KB แรกแล้วตอบ error ว่าเป็นไฟล์ไบนารี; ไฟล์ไม่มี/ไม่มีสิทธิ์อ่านได้ error ตาม errno
- ไม่ติดตาม symlink ที่ออกนอก Workdir (จาก resolver)

### `write`

- สร้างโฟลเดอร์พ่อด้วย `mkdir -p` ภายใน Workdir
- เขียนไฟล์ชั่วคราวชื่อ `<name>.tmp-<random>` ในโฟลเดอร์เดียวกันด้วย `mode 0o600` แล้ว `rename` ทับ; ถ้าไฟล์เดิมมีอยู่ให้คง mode เดิม (อ่าน `stat` ก่อน) เพื่อไม่ให้สิทธิ์หลุด
- จำกัดเนื้อหา 2MB; คืนจำนวนไบต์
- ไม่มี `fsync` — งานนี้ต้องการ atomicity ไม่ใช่ durability หลังระบบขัดข้อง

### `edit`

- อ่านไฟล์ทั้งไฟล์ (จำกัด 2MB), นับ occurrence ของ `old_string` ด้วย `indexOf` แบบเลื่อน
- 0 ครั้ง → error "found 0"; มากกว่า 1 ครั้งและไม่ใช่ `replace_all` → error "found N"
- `replace_all` แทนทุก occurrence; ไม่ใช่ regex เพื่อให้ผู้เรียกควบคุมได้
- เขียนกลับแบบ atomic และคง mode; คง line ending เดิม (ไม่แปลง)
- `old_string` ว่างเปล่า → error

### `glob`

- ใช้ `Bun.Glob` กับ `cwd: workdir`; `scan` แล้วกรองโฟลเดอร์ออก, ข้าม path ที่มี `.git/` หรือ `node_modules/` เป็นส่วนประกอบ
- คืน path relative ที่ normalize แล้ว เรียงตามตัวอักษร จำกัด 200; ถ้าเกินให้ต่อท้ายด้วยข้อความว่ามีมากกว่านั้น
- ไม่มีผลลัพธ์ → ข้อความ "no files matched" (ไม่ใช่ error)
- pattern ที่ไม่ถูกต้อง → error

### `grep`

- ใช้ `Bun.Glob` ตาม `include` (ค่าเริ่มต้น `**/*`) แล้วอ่านทีละไฟล์:
  - ข้าม `.git`, `node_modules`, ไฟล์ไบนารี (NUL ใน 8KB แรก), ไฟล์ใหญ่กว่า 1MB
  - compile `new RegExp(pattern, ignore_case ? "i" : "")` ครั้งเดียว; pattern จำกัด 500 ตัวอักษร
  - อ่านทีละบรรทัด (split) แล้วเก็บ `path:line: text`; หยุดที่ 200 บรรทัดที่ตรงและบอกว่ามีมากกว่านั้น
- ไม่มีผล → ข้อความ "no matches"; regex ผิด → error
- ไม่เรียก `rg`/`grep` ภายนอก เพราะ macOS ไม่ได้รับประกันว่ามี `rg` และการเรียกโปรเซสลูกใน sandbox เพิ่มพื้นที่ผิดพลาด

### โหมดอ่านอย่างเดียวและ runner รวม

- `fileTools({ workdir, readOnly = false })`: `definitions()` คืน `read`, `glob`, `grep` เสมอ และเพิ่ม `write`, `edit` เมื่อ `readOnly` เป็นเท็จ; `run` ตรวจชื่อและโหมดก่อนทำงาน
- `worker/adapters/tools.ts` มี `combineTools(runners)` ที่รวม definitions และส่ง `run` ตามชื่อ; ชื่อซ้ำให้ throw ตอนสร้าง
- `worker/index.ts` สร้าง `combineTools([bashTool(...), fileTools({ workdir })])`

ทางเลือกที่ตัดออก: แยก runner ต่อ tool (ชื่อซ้ำง่ายและต้องส่งหลายตัวให้ core), ให้ Subagent ใช้ adapter คนละไฟล์ (ซ้ำ logic)

## Risks / Trade-offs

- [regular expression ที่ใช้เวลานาน (ReDoS)] → จำกัดความยาว pattern 500 ตัวอักษรและขนาดไฟล์ 1MB; ถ้าพบว่าช้าให้ย้าย grep ไปโปรเซสลูกที่มี timeout ใน change ถัดไป
- [symlink เปลี่ยนระหว่างตรวจกับเขียน (TOCTOU)] → ตรวจ realpath ก่อนทุกครั้งและเขียนผ่าน temp+rename ในโฟลเดอร์ที่ตรวจแล้ว; sandbox ยังเป็นด่านสุดท้าย
- [ไฟล์ใหญ่กินหน่วยความจำ] → read ตัดที่ 256KB, write/edit จำกัด 2MB, grep ข้ามไฟล์เกิน 1MB
- [Agent เขียน `.git/hooks` แล้วเจ้าของรัน git ข้างนอก sandbox] → เป็นความเสี่ยงเดิมของ ADR 0032; file tools ไม่ได้เพิ่มความเสี่ยง และ manual-checks เตือนเจ้าของ
- [`glob` บน repo ใหญ่ช้า] → ข้าม `node_modules` กับ `.git` และจำกัด 200 ผล; ยอมรับว่า pattern ที่กว้างมากอาจใช้เวลาหลายวินาที
- [line ending และ encoding ต่างกัน] → edit คงเนื้อหาเดิมเป็นสตริง ไม่แปลง; read แสดงตามไบต์ที่อ่านได้ ไม่แปลง encoding

## Migration Plan

ไม่มีข้อมูลหรือ protocol ที่ต้องย้าย; เป็นการเพิ่ม tool ใน worker และเปิดใช้ทันทีเมื่อ worker เริ่มใหม่

## Open Questions

ไม่มี — การเพิ่ม rename/delete หรือ patch หลายไฟล์เป็น change ใหม่เมื่อมีคนขอ
