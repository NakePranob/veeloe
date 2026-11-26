## Why

Agent ทำงานได้เฉพาะตอนที่ Member พิมพ์สั่ง ยังทำงานตามเวลาเองไม่ได้ ADR 0027 และ 0067 กำหนดให้งานที่ Agent เริ่มเองเข้า harness ในรูป Trigger ที่ Member เซ็นไว้ล่วงหน้า change นี้ทำฐานของ Trigger ที่ Idle Work (#57), Watch (#58) และเส้นร้อย Task (#59) จะใช้ร่วมกัน และทำ Schedule ซึ่งเป็น Trigger ชนิดแรก (issue #56)

## What Changes

- Protocol มีข้อความใหม่ `trigger.set`, `trigger.pause`, `trigger.resume`, `trigger.delete`, `trigger.run`, `trigger.list` และคำตอบ `trigger.listed` พร้อม vectors ทั้งฝั่ง Rust และ TypeScript
- supervisor เก็บ Trigger ที่เซ็นแล้วไว้ใน `runtime/triggers.json` นอก sandbox ทุกตัว พร้อมซองที่เซ็นทั้งซอง ตรวจลายเซ็น การถอนกุญแจ และ Use ตอนรับ แล้วตรวจซ้ำก่อนเริ่มทุกรอบ
- เมื่อถึงรอบ supervisor ส่ง `ToWorker::Run` ที่มี `trigger` ให้ worker และ `turn.started` บันทึก `trigger` (`kind`, `id`, `at`) กับ `member` เป็น field ที่ไม่บังคับ
- Turn ที่มาจาก Trigger มี tool `nothing_to_report` ถ้า Agent เรียก Turn จบด้วย `reason: "quiet"` และ Task ไม่ขึ้นใน Inbox
- Schedule มีสามแบบ: ทุก N นาที (อย่างน้อย 15), ทุกวันตามเวลา และทุกสัปดาห์ตามวันและเวลา ตามเวลาของ Machine ข้ามรอบเมื่อ Agent ไม่ว่างหรือ Budget หมด รันชดเชยครั้งเดียวเมื่อพลาดรอบตอนเครื่องปิด และ `trigger.listed` ส่งเวลารอบถัดไปมาด้วย
- กุญแจที่ถูกถอนระงับ Trigger ทุกอันที่กุญแจนั้นเซ็นทันที Agent ในถังขยะไม่รัน Trigger และกลับมารันเมื่อกู้คืน
- `usage` แยกที่มาเป็น `schedule`
- Controller มีหน้า Schedule ในหน้า Agent สำหรับสร้าง แก้ พัก ลบ และรันทันที
- ADR 0067 ชี้มาที่ spec แม่ (#53) แทน checklist ใน `docs/roadmap.md` ที่ไม่มีแล้ว

## Capabilities

### New Capabilities

- `triggers`: Trigger ที่เซ็นแล้วบน Machine การตรวจสิทธิ์ การเข้า harness, Turn แบบ quiet และ Schedule
- `controller-schedules`: หน้า Schedule ของ Agent ใน Controller

### Modified Capabilities

ไม่มี

## Impact

- **Protocol:** `packages/protocol/src/messages.rs`, `packages/protocol-ts/src/messages/`, `packages/protocol/vectors/messages.json`
- **Runtime:** `runtime-core` (`ToWorker::Run`, `turn.started`, `nothing_to_report`, `quiet`), `runtime-supervisor` (ที่เก็บ Trigger, ตัวนับรอบ, dispatch, usage source, การถอนกุญแจ)
- **Controller:** หน้าใหม่ใต้หน้า Agent, Inbox ซ่อน Task ที่จบแบบ quiet
- **Hub:** ไม่เปลี่ยน ยังส่งต่อซองอย่างเดียว
- **ADR:** แก้ 0067 ให้ชี้ไปที่ spec แม่
