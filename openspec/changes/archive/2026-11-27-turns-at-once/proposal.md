## Why

ตอนนี้ Agent ทำได้ทีละ Turn ทุกอย่างจึงต่อคิวเดียวกัน คนที่เปิด Task ใหม่ถามสั้นๆ ต้องรอ Idle Work หรือ Task อื่นทำจบ งานที่แค่อ่านหรือคุยต้องรองานที่แก้ไฟล์ และรอบของ Schedule ถูกข้ามเพราะ Agent ไม่ว่าง ADR 0080 (แทนที่ ADR 0011) ตัดสินให้ Turn เริ่มได้ทันที และรอกันเฉพาะตอนจะเขียน โดยงานของคนได้ก่อนงานพื้นหลัง (issue #65)

## What Changes

- Turn ของคนละ Task เริ่มได้พร้อมกันทันที ไม่ต่อคิวต่อ Agent อีก ส่วนข้อความที่เข้า Task ที่ Turn ยังไม่จบยังรอ Turn นั้นจบตามเดิม (ต่อคิวต่อ Task)
- Workdir ของ Agent มีล็อกที่เขียน Turn ขอเมื่อจะเรียก `write`, `edit` หรือรันคำสั่งที่ไม่ใช่คำสั่งในตัวของ ADR 0075 และถือไว้จน Turn จบ การอ่าน ค้น คำสั่งในตัว และ tool อื่นไม่ขอล็อก
- `MEMORY.md` และบันทึกรายวันเขียนผ่านล็อกเล็กของตัวเองเฉพาะตอนเขียน ไม่ถือทั้ง Turn
- Turn ของคนได้ล็อกก่อน Turn ของงานพื้นหลัง (Schedule, Idle Work) ช่วงที่รอล็อกไม่นับเป็น Turn ค้าง และ Stop จบ Turn ที่กำลังรอล็อกได้
- รอบของ Schedule จบภายใน 15 นาทีเหมือนชิ้นของ Idle Work
- Schedule ไม่ข้ามรอบเพราะมี Turn อื่นทำอยู่ ข้ามเฉพาะเมื่อรอบก่อนของ Schedule เดียวกันยังไม่จบ `trigger.run` ตอบ `agent.busy` เฉพาะกรณีนี้
- Idle Work ตื่นเมื่อไม่มี Turn ของคนกำลังทำ และนับเวลาเงียบจาก Turn ของคนล่าสุด Turn ของงานพื้นหลังไม่นับ
- supervisor นับ Turn ทีละตัวต่อ Task แทน "Turn ปัจจุบันของ Agent" ทั้งใน Approval, การนับว่าไม่ว่าง และ proxy โดยคำขอที่ผ่าน proxy บอกได้ว่ามาจาก Turn ไหน Approval ของโดเมนจึงถามถูกคน
- Controller: Inbox นับว่า Agent กำลังทำงานถ้ามี Task ไหนที่ Turn ยังไม่จบ และ sheet ของ Schedule บอกว่ารอบที่ข้ามเพราะรอบก่อนยังไม่จบ
- ไม่เปลี่ยน Protocol: `agent.busy` ยังอยู่ ส่วน Turn ที่ทำพร้อมกันเห็นได้จาก event เดิม

นอกขอบเขต: ล็อกของ Project, worktree และ Library, การยืมล็อกของ Delegation, Channel, Watch และ worker หนึ่งตัวต่อชุดสิทธิ์ ยังไม่มีในโค้ด จะใช้กฎของ ADR 0080 เมื่อสร้างสิ่งเหล่านั้น ตอนนี้ทุก Turn ของ Agent มีสิทธิ์ชุดเดียวกันจึงใช้ worker ตัวเดียวต่อ Agent ต่อไป

## Capabilities

### New Capabilities
- `workdir-write-lock`: ล็อกที่เขียนของ Workdir และ `MEMORY.md`: ขอเมื่อไหร่ ถือนานแค่ไหน ใครได้ก่อน การรอไม่นับเป็น Turn ค้าง และ Stop ของ Turn ที่รอ

### Modified Capabilities
- `task-queue`: คิวเปลี่ยนจากต่อ Agent เป็นต่อ Task และ Turn ของคนละ Task เริ่มพร้อมกัน
- `task-log`: เอาข้อ "Agent ทำทีละ Turn" ที่ตอบ `agent.busy` ออก ข้อนี้ขัดกับ task-queue อยู่แล้ว
- `triggers`: Schedule ข้ามเฉพาะเมื่อรอบก่อนของตัวเองยังไม่จบ, รอบของ Schedule มีเพดาน 15 นาที, Idle Work ตื่นตาม Turn ของคน, `lastSkip` ของ `busy` เปลี่ยนความหมาย
- `controller-tasks`: ส่งข้อความเข้า Task อื่นได้ทันทีระหว่างที่ Agent ทำ Turn อยู่ และสถานะกำลังทำงานใน Inbox นับทุก Task ของ Agent
- `controller-schedules`: คำของรอบที่ข้ามเพราะ `busy`
- `runtime-sandbox`: Approval ของโดเมนนอก Egress ผูกกับ Turn ที่คำขอนั้นมาจาก

## Impact

- `packages/runtime/crates/runtime-core/src/agent.rs`: Turn หลายตัวพร้อมกัน, คิวต่อ Task, ล็อกที่เขียน, การนับ Turn ค้างและ Stop ต่อ Turn
- `packages/runtime/crates/runtime-worker`: tool `memory` ใช้ล็อกของ `MEMORY.md`, คำสั่งและ `web_fetch` ส่งตัวตนของ Turn ไปกับ proxy
- `packages/runtime/crates/runtime-supervisor`: `approval.rs` (Turn ต่อ Task), `proxy.rs`, `main.rs` (Idle Work, การนับเงียบ), `triggers.rs` และ `messages/trigger.rs` (busy ของ Schedule, เพดาน 15 นาที)
- `controller/`: Inbox (สถานะกำลังทำงาน), sheet ของ Schedule (คำของ `busy`)
- `CONTEXT.md`: คำของ Agent, Turn, Idle Work, Stop และ Memory
- test: binary test ของ runtime-core และ supervisor, e2e ที่ส่งสองข้อความเข้าสอง Task แล้วได้สอง Turn พร้อมกัน
