# Tasks

## 1. กฎ Allowlist กับ schema ของ Protocol

- [x] 1.1 เพิ่มตัวแยกท่อนกับเทียบคำนำหน้า (`splitCommand`, `matchesAllowlist`) พร้อม unit test ครบทุกแบบที่ต้องขอ Approval (`&&`, `;`, `|`, `$(...)`, backtick, `eval`) และตรวจด้วย `bun test`
- [x] 1.2 เพิ่ม `allowlist` ใน `agent.create` / `agent.update` / `agent.listed`, เพิ่ม `approval.answer` กับ body ของ `approval.requested` / `approval.answered` ใน `packages/protocol` พร้อม test ของ schema และตรวจด้วย `bun run check`

## 2. supervisor เก็บและส่ง Allowlist กับคำตอบ Approval

- [x] 2.1 เก็บ `allowlist` ใน `agents.json` รับจาก `agent.create` กับ `agent.update` ทั้งชุด ส่งใน `agent.listed` และตรวจ Manage ก่อนแก้ พร้อม test ของ slice และตรวจด้วย `bun test`
- [ ] 2.2 ส่งคำตอบ `approval.answer` จาก supervisor ไป worker ที่รอผ่าน IPC พร้อมตรวจ Approve กับรหัสคำขอที่รออยู่ และตรวจด้วย `bun test`

## 3. worker ขอ Approval แล้วหยุด Turn ไว้

- [x] 3.1 เพิ่ม guard ก่อนเรียก `bash` ใน worker core เขียน `approval.requested` แล้วแขวนคำขอไว้จนได้คำตอบ หมดเวลา (เริ่มต้น 1 ชั่วโมง) หรือ worker จบ พร้อม flow test ขอ–รอ–ได้คำตอบ และตรวจด้วย `bun test`
- [x] 3.2 เขียน `approval.answered` ทุกทาง (อนุมัติ ปฏิเสธ บอกให้ทำอย่างอื่น หมดเวลา) ส่ง error ให้ LLM เมื่อไม่ได้อนุมัติแล้วเดิน Turn ต่อ พร้อม test และตรวจด้วย `bun test`

## 4. Controller แสดงและตอบ Approval

- [x] 4.1 เพิ่มการ์ด Approval ในหน้า Task (อนุมัติ ปฏิเสธ บอกให้ทำอย่างอื่น อนุญาตตลอดพร้อมแก้คำนำหน้า) แสดงสถานะรอ อนุมัติแล้ว ปฏิเสธแล้ว หมดเวลา พร้อมข้อความ TH/EN และตรวจด้วย `bun run check` กับ `check-i18n`
- [x] 4.2 เพิ่มช่องติ๊กชุดอ่านอย่างเดียวในหน้าสร้าง Agent กับหน้า Allowlist ของ Agent (ดู เพิ่ม ลบ บันทึกทั้งชุด) พร้อมข้อความ TH/EN และตรวจด้วย `bun run check` กับ `check-i18n`
- [x] 4.3 เพิ่ม e2e ตอบ Approval จาก Controller ไปถึงคำสั่งที่รันจริง และตรวจด้วย `bun run test:e2e` (ต้องมี Go กับ Postgres ตาม AGENTS.md)

## Workflow follow-up

- ส่ง `reviewer` ตรวจ diff แบบ read-only ก่อนสรุปตาม AGENTS.md
- Archive change นี้แล้วติ๊ก `approval-and-allowlist` ใน `docs/roadmap.md` ใน commit เดียวกัน
