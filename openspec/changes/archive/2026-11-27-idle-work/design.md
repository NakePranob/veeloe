## Context

- Trigger, Schedule และ scope มีอยู่แล้ว (`triggers.rs`, `tick_triggers`, `start_round`, `TriggerRun { attended, allow }`)
- รอบที่ไม่มีคนเฝ้าปฏิเสธสิ่งนอก scope และเขียน `approval.skipped` อยู่แล้ว (ADR 0079)
- `Approvals::current_turn(agent)` บอกว่า Agent มี Turn อยู่หรือไม่ ส่วน `Turns::observe` เห็น `turn.ended` ของทุก Task
- `Budgets` แยก usage ตามที่มาได้แล้ว (`schedule`)

## Goals / Non-Goals

**Goals:** ลิสต์ที่เซ็น, การตื่นเมื่อเงียบ, เพดานเวลา, สถานะต่อชิ้น, ร่างจาก Agent, เพดานงานพื้นหลัง และหน้า Controller

**Non-Goals:** worktree แยกให้ Idle Work (ADR 0056 เลือกไม่ทำตอนนี้), push แจ้งงานที่ต้องการ Approval (รอ push ADR 0076), Watch (#58 ใช้เพดานร่วมนี้ทีหลัง)

## Decisions

- **รูปแบบ:** Trigger `kind: "idle"` ใช้ `TriggerRecord` เดิม โดย `schedule` ว่างและมี `idle: { items: [{ id, text, repeat? }], order, quietMinutes, itemMinutes }` หนึ่ง Agent มีลิสต์ `idle` ได้อันเดียว `trigger.set` ของ `idle` อันใหม่แทนอันเดิมของ Agent นั้น `text` ของ Trigger เป็นชื่อลิสต์ (ตั้งชื่อด้วย `trigger.title` แบบ Schedule)
- **สถานะต่อชิ้น:** supervisor เก็บ `{ status, lastRunAt, task }` ต่อ `item.id` แยกจากรายการที่เซ็น การเซ็นลิสต์ใหม่เก็บสถานะของชิ้นที่ `id` เดิมยังอยู่
- **การตื่น:** `tick_triggers` (ทุก 30 วินาที) ถือว่า Agent เงียบเมื่อไม่มี Turn และ Turn ล่าสุดของ Agent จบมาเกิน `quietMinutes` เวลาจบ Turn ล่าสุดอ่านจาก `Turns::observe` (เก็บ `last_ended_at` ต่อ Agent ในหน่วยความจำ) ตอน supervisor เริ่มใหม่ค่าเป็นเวลาที่เริ่ม จึงไม่ตื่นทันทีหลังเปิดเครื่อง (ไม่ชดเชย)
- **ทีละชิ้น:** มีชิ้น `working` อยู่ จะไม่เริ่มชิ้นใหม่ ชิ้นถัดไปเลือกตาม `order`: `ordered` คือชิ้น `pending` ตัวแรกในลิสต์ `oldest-first` คือชิ้น `pending` ที่ `lastRunAt` เก่าสุด (ยังไม่เคยรันมาก่อน)
- **จบงาน:** supervisor เห็น `turn.ended` ของ Task ที่เป็นงานชิ้นนั้น แล้วตั้งสถานะ: Task มี `approval.skipped` → `needsApproval`; จบเพราะเพดานเวลา → `timedOut`; อื่นๆ → `done` ชิ้น `done` ที่ไม่ใช่ `repeat` ออกจากลิสต์ที่ส่งใน `trigger.listed` (ยังอยู่ในซองที่เซ็นเพื่อตรวจย้อน) ส่วน `repeat` กลับเป็น `pending`
- **เพดานเวลา:** `TriggerRun` มี `limit_s` (ไม่บังคับ) worker ตั้งเวลาเมื่อเริ่ม Turn ครบแล้ว cancel เหมือน Stop และจบด้วย `turn.ended { reason: "stopped", code: "trigger.time_limit" }`
- **ข้อความระหว่างทำ:** คิวของ worker มีอยู่แล้ว ไม่ต้องแก้ (ADR 0056)
- **ร่างจาก Agent:** tool `propose_idle_work { items: [string] }` มีในทุก Turn ส่ง `FromWorker::IdleProposed` supervisor ต่อท้ายร่างของ Agent (เก็บใน `triggers.json` ไม่ได้เซ็น, สูงสุด 50 ชิ้น) และส่งใน `trigger.listed` เป็น `draft` ร่างไม่ถูกรัน การเซ็นลิสต์ใหม่ล้างร่าง
- **เพดานงานพื้นหลัง:** แถว Agent มี `background_share` (เปอร์เซ็นต์ 0-100, ค่าเริ่มต้น 30) `Budgets` รวม usage ที่มา `idle` และ `watch` ของวันนี้ ถ้าถึง `background_share` ของ Budget จะไม่เริ่มชิ้นใหม่ ชิ้นที่กำลังทำถูก Stop เมื่อ usage ที่ลงบันทึกข้ามเพดาน Agent ที่ไม่มี Budget ไม่มีเพดานนี้
- **Controller:** page slice `agent-idle-work` แบบหน้า Schedule (แถว + sheet) แสดงชิ้นตามลำดับพร้อมจุดสถานะ กดชิ้นแล้วเปิด Task ล่าสุดของชิ้นนั้น ร่างจาก Agent แสดงเหนือลิสต์พร้อมปุ่ม "เพิ่มเข้าลิสต์" ซึ่งเปิด sheet แก้ที่มีรายการร่างต่อท้ายแล้ว

## Risks / Trade-offs

- **`last_ended_at` ในหน่วยความจำ:** เริ่ม supervisor ใหม่แล้วต้องรอเวลาเงียบใหม่หนึ่งรอบ ยอมรับได้เพราะ Idle Work ไม่ชดเชยอยู่แล้ว
- **ชิ้นที่ `working` ตอนเครื่องดับ:** Turn ถูกปิดเป็น `interrupted` (ADR 0033) supervisor ที่เริ่มใหม่ตั้งชิ้นที่ค้าง `working` เป็น `timedOut`
- **เพดานร่วมนับตาม usage ที่ลงแล้ว:** Turn ที่กำลังทำอาจเกินเพดานได้หนึ่งคำตอบของ model ก่อนถูก Stop
