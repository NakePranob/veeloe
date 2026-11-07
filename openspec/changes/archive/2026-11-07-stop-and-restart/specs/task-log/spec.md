# Spec Delta

## ADDED Requirements

### Requirement: event ของการหยุดและของ Turn ที่ถูกขัดจังหวะอยู่ใน log แบบต่อท้ายอย่างเดียว
Task log SHALL มี event kind ใหม่ `turn.stopped` ที่ `body` มี `{ member }` ผู้สั่งหยุด และ `turn.interrupted` ที่ `body` มี `{ reason }` (v0.1 คือ `restart`) event ทั้งสอง SHALL ถูกเขียนก่อน `turn.ended` ของ Turn นั้นเสมอ `turn.ended` SHALL มี `reason` ที่เป็น `done`, `error`, `stopped` หรือ `interrupted` และ event ทุกตัว MUST NOT ถูกแก้หรือลบ

#### Scenario: หยุดแล้วมีบันทึกว่าใคร
- **WHEN** Owner กดหยุดระหว่าง Turn
- **THEN** log มี `turn.stopped` ที่มี Member ของ Owner ตามด้วย `turn.ended` ที่มี `reason: "stopped"`

#### Scenario: เริ่มใหม่แล้วมีบันทึก
- **WHEN** worker เริ่มใหม่และปิด Turn ที่ค้าง
- **THEN** log มี `turn.interrupted` ตามด้วย `turn.ended` ที่มี `reason: "interrupted"`

#### Scenario: Turn ที่จบปกติไม่เปลี่ยน
- **WHEN** Turn จบเพราะ LLM ตอบเสร็จ
- **THEN** log ยังมี `turn.ended` ที่มี `reason: "done"` และไม่มี event ของการหยุด
