## Context

- **Approval ของคำสั่งและ tool:** `run_tool` ใน `runtime-core/src/agent.rs` เทียบกับ Allowlist ก่อน ถ้าไม่ผ่านจะเรียก `ask_approval` แล้วรอคำตอบ
- **Approval ของโดเมน:** `Approvals::ask` ใน supervisor ถือ connection ไว้จนกว่าจะมีคำตอบ โดยดู Turn ที่รันอยู่จาก `turn.started`
- **รอบของ Trigger:** `start_round` ส่ง `ToWorker::Run { trigger }` และ `with_trigger` ใส่ `trigger` ลงใน event
- **การแก้ Schedule:** `trigger.set` แทน record ทั้งอันและล้าง `last_run_at`

## Decisions

- **การแยกรอบที่มีคนเฝ้า:** `TriggerRun` มี `attended: bool` และ `allow: Vec<String>` ซึ่ง serde ใส่ค่าเริ่มต้นให้ `start_round` รับสองค่านี้จากที่เรียก โดยรอบที่ถึงเวลาเองส่ง `attended = false` และ `trigger.run` ส่ง `attended = true` ส่วน `allow` ส่งไปก็ต่อเมื่อ `trust.approves` ของคนเซ็นยังผ่าน event ของ Task เพิ่มแค่ `attended` ไม่เขียน `allow` ลง log
- **ฝั่ง worker:** `run_turn` ได้ `Option<Unattended>` ซึ่งมีรายการ `allow` ถ้า `run_tool` ได้ค่านี้มา สิ่งที่ไม่ผ่าน Allowlist จะถูกเทียบกับ `allow` ด้วยกฎเดียวกันคือ `matches_allowlist` ถ้ายังไม่ผ่าน จะเขียน `approval.skipped { command, parts }` แล้วคืน error ให้ model ว่ารอบนี้ไม่มีคนเฝ้า
- **quiet หลังถูกปฏิเสธ:** ถ้ารอบนี้มี `approval.skipped` แล้ว Agent เรียก `nothing_to_report` tool จะคืน error ว่ามีสิ่งที่ทำไม่ได้และต้องบอกเจ้าของ Turn จึงไม่จบแบบ quiet
- **ฝั่ง proxy:** `Turns::observe` อ่าน `trigger.attended` จาก `turn.started` ถ้า Turn เป็นรอบที่ไม่มีคนเฝ้า `ask` จะเขียน `approval.skipped { domain }` แล้วปฏิเสธทันที `turn.started` มาจาก worker ซึ่งไม่น่าเชื่อถือ แต่ worker ที่โกหกว่ามีคนเฝ้าอยู่ ได้ผลแค่ไปถามคน จึงไม่เปิดช่องให้ทำอะไรเพิ่ม
- **รอบที่ข้าม:** record มี `last_skip: Option<{at, why}>` ซึ่งเขียนตอน `Round::Skip`
- **รอบของ Schedule ที่ถูกแก้:** ถ้า `schedule` ตรงกับของเดิม `trigger.set` จะเก็บ `last_run_at`, `created_at`, `paused` และ `last_skip` ไว้ การเพิ่มรายการเข้า scope จาก Task จึงไม่ทำให้รอบเลื่อน
- **Controller:**
  - "ให้ Schedule นี้ทำได้เลย" ส่ง `trigger.set` ของ Schedule เดิม โดยต่อรายการใหม่เข้า `allow` ถ้ากดบน Approval จะส่ง `approval.answer approve` ด้วย ทั้งสองข้อความเซ็นในการยืนยันตัวครั้งเดียว
  - รอบล่าสุดเลือกระหว่าง Task ล่าสุดของเส้นนั้น (`threadsOf`) กับ `lastSkip` ว่าอันไหนใหม่กว่า
  - หน้า Schedule เป็นแถวแบบหน้า Agent และรายละเอียดอยู่ใน sheet (`agents/[agent]/schedule/[trigger]`, `new` สร้างใหม่) แบบ sheet แก้ Character เวลาเลือกจาก `Select` (ชั่วโมงกับนาที) เพราะแอปยังไม่มี native time picker
  - ตัวเลือกที่ใช้น้อยของ Approval อยู่ในเมนูของ iOS ส่วน Android ยังเป็นลิงก์ใต้การ์ด

## Risks / Trade-offs

- **Controller รุ่นเก่า:** ไม่รู้จัก `allow` จึงส่ง `trigger.set` ที่ไม่มี `allow` ไปทับ scope เดิมจนหายได้ รับได้ เพราะยังไม่มีใครนอกจาก Owner ใช้ (ADR 0078)
- **Turn ที่ถูกปฏิเสธบ่อย:** ถ้า Agent เรียกคำสั่งที่ถูกปฏิเสธซ้ำๆ รอบนั้นจะเปลือง token แต่ยังติดเพดานรอบต่อ Turn อยู่
