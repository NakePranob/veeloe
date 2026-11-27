# task-log Specification

## Purpose

กำหนดว่า Task เก็บเป็น event log แบบต่อท้ายอย่างเดียวบน Runtime อย่างไร Turn เริ่มและจบเมื่อไหร่ และ Controller ได้ event และตามทันหลังหลุดได้อย่างไร (ADR 0018)

## Requirements

### Requirement: Task เป็น event log ที่ต่อท้ายอย่างเดียว
supervisor SHALL เก็บทุก Task ของ Agent เป็นลำดับของ event ในฐานข้อมูลของ Agent ตัวนั้น และ SHALL เป็นผู้เดียวที่เขียน event ลงฐานข้อมูล worker SHALL ส่ง event ให้ supervisor ทาง IPC และ MUST NOT เขียนฐานข้อมูลเอง แต่ละ event SHALL มีเลขลำดับภายใน Task ที่เริ่มที่ 1 และเพิ่มทีละ 1 event MUST NOT ถูกแก้หรือลบ event ของ v0.1 SHALL มีข้อความของ Member พร้อมชื่อ Member, การเริ่ม Turn, ผลจาก LLM ตามที่ได้รับทุกตัวอักษรรวมถึง thinking block, การเรียก tool กับผลของ tool, การจบ Turn พร้อมเหตุผล และชื่อของ Task (`task.titled`) ฐานข้อมูล SHALL อยู่นอกโฟลเดอร์ที่ sandbox เปิดให้ Agent เขียน และไม่อยู่ใน Workdir (ADR 0018, 0032) สำหรับ Agent ที่มีฐานข้อมูลอยู่ก่อนการย้ายเจ้าของผู้เขียน supervisor SHALL ทำให้ประวัติเดิมต่อเนื่องได้โดย Owner ไม่ต้องทำอะไร

#### Scenario: Turn ที่จบปกติ
- **WHEN** Owner ส่งข้อความแล้ว LLM ตอบ
- **THEN** log มีข้อความของ Owner, การเริ่ม Turn, ผลจาก LLM และการจบ Turn ตามลำดับ เลขต่อกันไม่ขาด

#### Scenario: เริ่มใหม่
- **WHEN** worker เริ่มใหม่
- **THEN** event เดิมทุกตัวยังอยู่ด้วยเลขเดิม

#### Scenario: worker ตายกลาง Turn
- **WHEN** worker ตายหลัง supervisor บันทึก event ของ Turn แล้ว
- **THEN** event ที่บันทึกแล้วยังอยู่ใน log หลังเปิด worker ใหม่

#### Scenario: ชื่อของ Task
- **WHEN** harness ได้ชื่อของ Task จาก LLM
- **THEN** log มี `task.titled` เป็น event ถัดไปด้วยเลขที่ต่อกัน และไม่มี event เดิมตัวใดถูกแก้

### Requirement: Owner เริ่มและคุยต่อใน Task ได้
ข้อความถึง Agent SHALL ระบุรหัสข้อความ, รหัส Task และข้อความ ข้อความแรกของรหัส Task ใหม่ SHALL เริ่ม Task ใหม่ และข้อความต่อมาใน Task เดิม SHALL ต่อจากบทสนทนาเดิม ข้อความที่มีรหัสข้อความซ้ำ SHALL NOT ถูกเพิ่มซ้ำ Turn SHALL ทำในนามของ Member ที่ส่งข้อความนั้น

#### Scenario: Task ใหม่
- **WHEN** Owner ส่งข้อความแรกด้วยรหัส Task ใหม่
- **THEN** worker สร้าง Task และเริ่ม Turn

#### Scenario: คุยต่อ
- **WHEN** Owner ส่งข้อความที่สองใน Task เดิม
- **THEN** LLM ได้บทสนทนาเดิมทั้งหมดตามลำดับ ตามด้วยข้อความใหม่

#### Scenario: ส่งซ้ำ
- **WHEN** ข้อความเดิมถูกส่งอีกครั้งเพราะ Controller ต่อใหม่
- **THEN** log ไม่มีข้อความนั้นซ้ำและไม่มี Turn ใหม่

### Requirement: harness ทำ Turn จาก log และเรียก tool เป็นรอบ
harness SHALL สร้างบทสนทนาที่ส่งให้ LLM จาก event ใน log เท่านั้น เมื่อ LLM ขอเรียก tool harness SHALL เรียก tool บันทึกผล แล้วส่งให้ LLM ต่อจนกว่า LLM จะตอบโดยไม่ขอ tool เมื่อ LLM ขอ tool ที่ Agent ไม่มี harness SHALL ส่งผลว่าเป็น error ให้ LLM แทนการหยุด Turn เมื่อ Provider ล้มเหลว Turn SHALL จบด้วย error code ที่บอกว่าเป็นที่ Provider

#### Scenario: เรียก tool
- **WHEN** LLM ขอเรียก tool ที่ Agent มี
- **THEN** log มีการเรียกกับผลของ tool และ LLM ได้ผลนั้นในคำขอถัดไป

#### Scenario: tool ที่ไม่มี
- **WHEN** LLM ขอ tool ที่ Agent ไม่มี
- **THEN** LLM ได้ผลที่เป็น error และ Turn ยังเดินต่อ

#### Scenario: Provider ล้มเหลว
- **WHEN** Provider ตอบ error กลาง Turn
- **THEN** Turn จบด้วยเหตุผลที่มี error code และ Task ยังคุยต่อได้

### Requirement: event ไปถึง Member ที่เริ่ม Task และตามทันได้
supervisor SHALL ส่งทุก event ใหม่ของ Task ในซองที่เซ็นด้วยกุญแจของ Machine ถึง Member ที่เริ่ม Task นั้น (ADR 0034, 0060) Controller SHALL ขอ event ของ Task หลังเลข N ได้ด้วยคำขอที่เซ็น และ supervisor SHALL ตอบเฉพาะ Task ที่ Member ของคนขอเป็นคนเริ่ม คำตอบที่ยาว SHALL แบ่งเป็นหลายซองตามลำดับ

#### Scenario: event ใหม่
- **WHEN** worker บันทึก event ใหม่ใน Task
- **THEN** Controller ของ Member ที่เริ่ม Task ได้ event นั้นพร้อมเลขลำดับ

#### Scenario: ต่อใหม่หลังหลุด
- **WHEN** Controller หลุดไประหว่าง Turn แล้วต่อใหม่และขอ event หลังเลขล่าสุดที่มี
- **THEN** ได้ event ที่ขาดไปครบตามลำดับ และไม่ได้ event ที่มีแล้ว

#### Scenario: Task ของคนอื่น
- **WHEN** คำขอ event มาจาก Member ที่ไม่ได้เริ่ม Task นั้น
- **THEN** supervisor ตอบ error code `task.not_found` และไม่ส่ง event

### Requirement: event คู่ของ Approval อยู่ใน log แบบต่อท้ายอย่างเดียว
Task log SHALL มี event kind ใหม่สองตัวคือ `approval.requested` กับ `approval.answered` ซึ่งเป็น event แบบต่อท้ายอย่างเดียวเหมือน event อื่นและ MUST NOT ถูกแก้หรือลบ `body` ของ `approval.requested` SHALL มีรหัสคำขอ คำสั่งเต็มที่ขอ รายการท่อนที่แยกแล้ว และเวลาหมดอายุ `body` ของ `approval.answered` SHALL มีรหัสคำขอ Member ที่ตอบ และการตัดสินใจ

#### Scenario: ขอแล้วตอบ
- **WHEN** worker ขอ Approval แล้ว Owner ตอบอนุมัติ
- **THEN** log มี `approval.requested` ตามด้วย `approval.answered` ที่มีรหัสคำขอเดียวกันตามลำดับ

#### Scenario: เริ่มใหม่แล้วยังอยู่
- **WHEN** worker เริ่มใหม่หลังขอ Approval
- **THEN** event ทั้งสองตัวยังอยู่ด้วยเลขเดิม

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

### Requirement: Turn ที่เงียบเกินห้านาทีมี event turn.stalled
Task log SHALL มี event kind ใหม่ `turn.stalled` ที่ `body` มี `{ since }` คือเวลาของกิจกรรมล่าสุดก่อนเงียบ supervisor SHALL เขียน `turn.stalled` เมื่อ Turn ที่ยังไม่จบไม่มี event ใหม่และไม่มี output ของคำสั่งที่กำลังรันติดต่อกันห้านาที ช่วงที่ Approval รอคนตอบ SHALL ไม่ถูกนับ supervisor SHALL เขียน `turn.stalled` ไม่เกินหนึ่งครั้งต่อช่วงที่เงียบ และ SHALL เขียนได้อีกเมื่อมีกิจกรรมแล้วเงียบครบห้านาทีอีกรอบ event ถัดไปของ Turn SHALL ถือว่า Turn ไม่ค้างแล้วโดยไม่มี event แยก `turn.stalled` เป็น event แบบต่อท้ายอย่างเดียวและ MUST NOT ถูกแก้หรือลบ

#### Scenario: Provider ไม่ตอบ
- **WHEN** Turn หนึ่งส่งคำขอถึง Provider แล้วไม่ได้คำตอบเป็นเวลาห้านาที
- **THEN** Task log มี `turn.stalled` หนึ่ง event ต่อท้ายใน Turn นั้น

#### Scenario: คำสั่งยังพิมพ์ output
- **WHEN** คำสั่งหนึ่งรันแปดนาทีโดยพิมพ์ output ทุกสิบวินาที
- **THEN** Task log ไม่มี `turn.stalled` ใน Turn นั้น

#### Scenario: รอ Approval
- **WHEN** Agent ขอ Approval และไม่มีใครตอบเป็นเวลาสิบนาที
- **THEN** Task log ไม่มี `turn.stalled` ระหว่างที่ Approval รออยู่

#### Scenario: ค้างแล้วเดินต่อแล้วค้างอีก
- **WHEN** Turn เงียบห้านาที แล้วได้คำตอบจาก Provider แล้วเงียบอีกห้านาที
- **THEN** Task log มี `turn.stalled` สอง event คั่นด้วย `llm.message`
