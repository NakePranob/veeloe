## Context

- **Runtime core:** `ToWorker::Message` เข้า `AgentCore::message` ซึ่งเขียน `member.message` แล้ว `turn.started` ที่มี `{ member }` และ `run_turn` วนเรียก LLM ถ้า `stop_reason` ไม่ใช่ `tool_use` Turn จบ `done` ส่วน Turn ที่ซ้อนกันจะเข้าคิว `queued`
- **supervisor:** `on_envelope` ตรวจลายเซ็นและกุญแจกับ `Trust::trusted_keys()` แล้ว `dispatch` ไปยัง `messages/*.rs` ซึ่งตอบด้วย `outbox.send`/`outbox.error` ส่วน `Approvals::current_turn(agent)` รู้ว่า Agent กำลังทำ Turn อยู่ไหม `Budgets::exhausted` รู้ว่า Budget หมดหรือยัง และ `Budgets::add` บันทึก usage ด้วย source `task` ทุกครั้ง
- **Trust:** v0.1 มี Member เดียวคือ Owner ซึ่งมีทุกสิทธิ์ (`Trust::manages`/`approves`) ยังไม่มี Grant ต่อ Agent
- **Controller:** หน้าย่อยของ Agent เป็น page slice + route ใน `app/agents/[agent]/` คำถามที่รอคำตอบจาก Machine อยู่ใน `features/machine-link/model/links.ts` แบบเดียวกับ `memory.get`/`memory.got`

## Goals / Non-Goals

**Goals:**

- ฐานของ Trigger ที่ Idle Work และ Watch ต่อได้โดยไม่ต้องแก้ Protocol อีก (`kind` เป็น enum ที่โตได้)
- Schedule ทำงานบน Machine ได้เองครบตาม issue #56

**Non-Goals:**

- Idle Work (#57), Watch (#58), เส้นร้อย Task ใน Controller (#59)
- push เมื่อรอบจบ: เก็บค่า `notify` ไว้ แต่ยังไม่ส่ง (ADR 0076)
- Grant ต่อ Agent: ใช้ `Trust` แบบเดิม

## Decisions

### 1. ที่เก็บเป็นไฟล์ JSON ไฟล์เดียวของ supervisor

`runtime/triggers.json` (0600) แบบเดียวกับ `push-tokens.json` โหลดครั้งเดียว แก้ใต้ lock และเขียนใหม่ทั้งไฟล์ทุกครั้งที่เปลี่ยน แต่ละ record มี `id`, `kind`, `agent`, `member`, `key`, `text`, `schedule`, `notify`, `paused`, `suspended`, `createdAt`, `lastRunAt` และ `envelope` (ซองที่เซ็นทั้งซอง)

**Rejected:** SQLite แบบ usage ใช้ได้ แต่รายการมีไม่กี่สิบอันและไม่ต้อง query

### 2. รูปของ Schedule เป็นโครงสร้าง

`{ "every": { "minutes": 60 } }`, `{ "daily": { "at": "09:00" } }` หรือ `{ "weekly": { "day": 1, "at": "08:30" } }` โดย `day` 0 คือวันอาทิตย์ ทุก N นาทีนับจาก `lastRunAt` หรือ `createdAt` ส่วนทุกวันและทุกสัปดาห์นับตามเวลาท้องถิ่นของ Machine ผ่าน `localtime_r`/`mktime` ของ libc ซึ่ง crate ใช้อยู่แล้ว ฟังก์ชันคำนวณรอบรับตัวแปลงเวลาเข้ามา เพื่อให้ test ใช้ UTC ได้

### 3. ตัวนับรอบเป็น loop เดียวทุก 30 วินาที

`tokio::spawn` หนึ่งตัวใน supervisor ทุกรอบจะไล่ Trigger ที่ไม่พักและไม่ระงับ หา `due` = รอบล่าสุดที่ ≤ now ซึ่งหลัง `lastRunAt` ถ้ามี ให้ตรวจตามลำดับนี้

1. Agent อยู่ในถังขยะ: ไม่ทำอะไร และไม่เปลี่ยน `lastRunAt` เพื่อให้กู้คืนแล้วรันต่อได้
2. กุญแจถูกถอนหรือไม่มีสิทธิ์แล้ว: ตั้ง `suspended`
3. Agent กำลังทำ Turn หรือ Budget หมด: ข้ามรอบโดยตั้ง `lastRunAt = due` และเขียน log
4. ไม่อย่างนั้น ส่ง `ToWorker::Run` แล้วตั้ง `lastRunAt = due`

การชดเชยตอนเปิดเครื่องจึงได้จากกฎเดียวกัน: `due` คือรอบล่าสุดที่พลาด จึงรันครั้งเดียว

**Rejected:** ตั้ง timer ต่อ Trigger — ต้องยกเลิกและตั้งใหม่ทุกครั้งที่แก้ พัก หรือถอนกุญแจ ส่วน loop 30 วินาทีพลาดเวลาได้ไม่เกิน 30 วินาที

### 4. `ToWorker::Run` เป็น variant ใหม่

`Run { task, member, text, trigger: { kind, id, at } }` core จัดการด้วยทางเดียวกับ `Message` แต่ใช้ `id` ของข้อความเป็น `trigger:<id>:<at>` ให้ส่งซ้ำได้ เขียน `member.message` ที่มี `trigger` และ `turn.started` ที่มี `{ member, trigger }` แล้วจำไว้ใน `RunningTurn` ว่า Turn นี้มาจาก Trigger

### 5. `nothing_to_report` อยู่ใน core ไม่ใช่ใน ToolRegistry

core เพิ่ม definition ของ `nothing_to_report` ลงในคำขอเฉพาะ Turn ที่มาจาก Trigger และเมื่อ Agent เรียก tool นี้ core จะเขียน `tool.result` แล้วจบ Turn ด้วย `reason: "quiet"` โดยไม่ส่งต่อให้ registry ถ้า Agent เรียก tool อื่นมาพร้อมกัน tool อื่นจะรันก่อน แล้วจึงจบแบบ quiet

**Rejected:** ลงทะเบียนเป็น tool ปกติ — registry เป็นของทั้ง worker และจะมี tool นี้ใน Turn ปกติด้วย

### 6. usage source มาจากที่เก็บ Trigger

supervisor จำ Task ที่ตัวเองเริ่มจาก Trigger ไว้ (`triggers.source_of(task)`) และ `Budgets::add` รับ source เข้ามา ไม่ใช่เขียน `task` ตายตัว

### 7. ตรวจสิทธิ์ด้วย `Trust::uses`

เพิ่ม `Trust::uses(member, key)` ซึ่ง v0.1 เหมือน `manages` เพื่อให้วันที่มี Grant ต่อ Agent แก้แค่ฟังก์ชันนี้ และใช้ทั้งตอนรับและก่อนทุกรอบ

### 8. Controller ถือ `trigger.listed` ไว้ในหน่วยความจำ

ใช้ store แบบเดียวกับ Memory ใน `links.ts` key เป็น machine+agent ไม่เก็บลงฐานข้อมูลบนเครื่อง เพราะหน้าถามใหม่ทุกครั้งที่เปิด แถวในหน้า Agent บอกจำนวนจากคำตอบล่าสุด ถ้ายังไม่เคยถามก็ไม่บอกจำนวน

### 9. Inbox ซ่อน Task ที่ Turn ล่าสุดจบแบบ quiet

กรองตอนสร้างรายการ Inbox จาก `latest_kind`/`latest_body` ที่เก็บอยู่แล้ว

## Risks / Trade-offs

- ตัวนับรอบอาศัยนาฬิกาของ Machine ถ้าผู้ใช้เปลี่ยนเวลาเครื่องย้อนหลัง รอบจะรอจนเลย `lastRunAt` ไปก่อน
- DST: `mktime` จัดการให้ เวลาที่ไม่มีอยู่จริงในวันที่เปลี่ยนเวลาจะเลื่อนไปตามที่ libc ทำ
- test:e2e ผ่าน relay ของ Schedule ต้องรอให้รอบถึง จึงใช้ `trigger.run` แทนการรอเวลาจริง ส่วนการนับรอบตรวจด้วย unit test ที่ใส่เวลาเอง
- ข้อความของ Trigger ส่งถึง worker ทุกรอบโดยไม่ตรวจลายเซ็นซ้ำ ตาม ADR 0067 ลายเซ็นตรวจครั้งเดียวตอนรับ และตรวจกุญแจกับสิทธิ์ซ้ำก่อนทุกรอบ
