## Context

- proxy เป็นของ Agent แล้ว (#43) และ Egress อยู่ที่ Agent
- supervisor เห็น event `turn.started` (มี member) และ `turn.ended` ผ่าน `on_message`; รู้ Task/Agent
- Approval ของคำสั่งวันนี้เกิดใน worker, ส่ง event ผ่าน IPC และ Controller ตอบ `approval.answer` กลับมาที่ worker

## Decisions

**Turn context ที่ supervisor:** เก็บ map Agent → (Task, Member, Turn id) จาก event `turn.started`/`turn.ended`; proxy ของ Agent ใช้ค่าล่าสุดเมื่อเจอโดเมนนอก Egress ถ้าไม่มี Turn ที่กำลังทำ ให้ตัด connection

**Approval อยู่ที่ supervisor:** proxy สร้าง request id, เขียน `approval.requested` (เพิ่ม `kind: "domain"`, `domain`, `agent`, `task`) ผ่าน TaskLogs และส่งให้ Member ผ่าน Hub; รอคำตอบจาก `approval.answer` ที่ supervisor ดักก่อนส่งต่อ worker (ถ้า request id อยู่ในชุดของ proxy)

**decision `always`:** คำตอบที่เซ็นโดย Owner เพิ่มโดเมนเข้า Egress ของ Agent ทันที (atomic ผ่าน Egress store) แล้วเขียน `approval.answered` ด้วย decision `always`; ครั้งต่อไป proxy อ่าน Egress ใหม่จึงไม่ถามอีก

**สิทธิ์:** ผู้ตอบต้องเป็น Member ที่มี Approve ที่ Agent นั้น (v0.1 = Owner ที่กุญแจเซ็น) และต้องเป็น Member ของ Turn ที่ขอ; คำตอบจากคนอื่นถูกปฏิเสธ

**fail closed:** timeout, Stop, หรือคำตอบที่ไม่ถูกต้อง → ตัด connection; ไม่มีทางผ่านแบบเงียบ

## Risks

- connection ค้างระหว่างรอ approval → มี timeout ตาม approval timeout และ Stop ตัดได้
- การเพิ่ม Egress ด้วย `always` ต้อง atomic และไม่ชนกับ `egress.set` พร้อมกัน → ใช้ store เดียวกันและเขียนทั้งไฟล์
- Controller รุ่นเก่าไม่รู้ decision `always` → ปุ่มใหม่ต้องมากับแอป; รุ่นเก่ายังอนุมัติครั้งเดียว/ปฏิเสธได้
