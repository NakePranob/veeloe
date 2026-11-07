# task-stop Specification

## Purpose

Stop คือการที่ Member สั่งให้ Turn ที่กำลังทำอยู่จบทันที ไฟล์ที่แก้แล้วคงสภาพเดิม และ Task ยังคุยต่อได้ รวมถึงกฎที่ว่า Turn ที่ค้างตอน worker เริ่มใหม่จบเหมือนโดน Stop

## Requirements


### Requirement: ซอง task.stop จาก Controller ถึง Machine
Protocol SHALL มีข้อความ `task.stop` จาก Controller ถึง Machine ที่มี `agent` และ `id` ของคำสั่ง (เพื่อให้ส่งซ้ำได้โดยไม่หยุดซ้ำ) โดยมีรหัส Task อยู่ในหัวซอง ข้อความ SHALL ถูกเซ็นและตรวจกุญแจเหมือนข้อความอื่นของ Controller และ supervisor SHALL ส่งต่อให้ worker ของ Agent นั้นเฉพาะเมื่อลายเซ็นและกุญแจผ่าน

#### Scenario: หยุด Turn ที่กำลังทำ
- **WHEN** Owner ส่ง `task.stop` ของ Task ที่ Agent กำลังทำ Turn อยู่
- **THEN** supervisor ส่งต่อให้ worker ของ Agent นั้น และ worker เริ่มหยุด Turn

#### Scenario: ส่งซ้ำ
- **WHEN** `task.stop` ด้วย `id` เดิมมาถึงอีกครั้ง
- **THEN** ไม่มีอะไรเปลี่ยน และไม่มี error

#### Scenario: Agent ไม่มีบน Machine
- **WHEN** `task.stop` ระบุ Agent ที่ Machine ไม่มี
- **THEN** Controller ได้ error code `agent.unknown`

#### Scenario: ไม่มี Turn กำลังทำ
- **WHEN** `task.stop` มาถึงขณะที่ Task นั้นไม่มี Turn ค้าง
- **THEN** Controller ได้ error code `turn.not_running` และ log ไม่เปลี่ยน

### Requirement: Stop ทำให้ Turn จบทันทีโดยไม่ย้อนอะไรกลับ
เมื่อได้ Stop ของ Task ที่มี Turn อยู่ worker SHALL หยุดทุกอย่างที่ Turn นั้นกำลังทำ ได้แก่ คำขอ LLM ที่ยังไม่ตอบ คำสั่ง bash ที่รันอยู่พร้อมโปรเซสลูกทั้งหมด และ Approval ที่ยังรอคำตอบ แล้ว SHALL เขียน event `turn.stopped` ที่มี Member ผู้สั่ง ตามด้วย `turn.ended` ที่มีเหตุผล `stopped` ไฟล์ที่แก้ไปแล้ว SHALL คงสภาพเดิม และ Task SHALL คุยต่อได้ด้วย context เดิม

#### Scenario: หยุดกลางคำสั่ง
- **WHEN** Agent กำลังรันคำสั่งที่ค้าง แล้ว Owner กดหยุด
- **THEN** คำสั่งและโปรเซสลูกถูกฆ่า ไม่เหลือโปรเซสค้าง และ log มี `turn.stopped` ตามด้วย `turn.ended` ที่มีเหตุผล `stopped`

#### Scenario: หยุดตอนรอ LLM
- **WHEN** Agent ส่งคำขอไป LLM แล้วยังไม่ตอบ แล้ว Owner กดหยุด
- **THEN** คำขอนั้นถูกยกเลิก ไม่มีการเขียน `llm.message` ของคำตอบที่มาทีหลัง และ Turn จบด้วย `stopped`

#### Scenario: หยุดตอนรอ Approval
- **WHEN** มีคำขอ Approval ค้างอยู่ของ Turn นั้น แล้ว Owner กดหยุด
- **THEN** Approval นั้นไม่รอต่อ Turn จบด้วย `stopped` และคำตอบที่มาทีหลังของคำขอนั้นได้ `approval.unknown`

#### Scenario: คุยต่อหลังหยุด
- **WHEN** Owner พิมพ์ข้อความใหม่ใน Task เดิมหลังหยุด
- **THEN** Turn ใหม่เริ่มด้วยบทสนทนาเดิมทั้งหมด และ LLM เห็นว่าคำสั่งที่ถูกหยุดไม่ได้ให้ผล

### Requirement: เฉพาะ Member ที่มี Use ที่ Agent หยุดได้
คำสั่ง Stop SHALL มาจาก Member ที่มี Grant ระดับ Use ขึ้นไปที่ Agent ตัวนั้น (ใน v0.1 คือ Owner ทุกคน) และ SHALL ไม่เปลี่ยนสิทธิ์ของใคร เพราะ Stop เป็นเบรก ไม่ได้ทำให้ใครทำอะไรเกินสิทธิ์ Turn ใน Task ที่คนเริ่มยังไม่ได้เปิดให้คนอื่นเห็น SHALL หยุดได้เฉพาะคนเริ่มกับคนที่มี Manage

#### Scenario: คนที่ไม่มีสิทธิ์
- **WHEN** Member ที่ไม่มี Use ที่ Agent ส่ง `task.stop`
- **THEN** supervisor ตอบ `agent.unknown` และ Turn ทำต่อ

### Requirement: worker ปิด Turn ที่ค้างทุกตัวเมื่อเริ่มใหม่
เมื่อ worker เริ่ม (ทั้งตอน Runtime เริ่มและตอน supervisor เปิดใหม่หลังพัง) worker SHALL หา Task ที่มี `turn.started` โดยไม่มี `turn.ended` ตามมา แล้วปิดทุกตัวด้วย `turn.interrupted` ตามด้วย `turn.ended` ที่มีเหตุผล `interrupted` worker SHALL NOT ทำ Turn ที่ค้างต่อเอง เพราะคำสั่งที่รันไปแล้วอาจยังไม่ทันบันทึกผล Turn ที่ปิดแล้ว SHALL ไม่ทำให้คำสั่งใหม่ถูกปฏิเสธ และคำขอ Approval ที่ค้างของ Turn นั้น SHALL นับว่าถูกปฏิเสธ

#### Scenario: worker พังกลาง Turn
- **WHEN** worker จบเองกลาง Turn แล้ว supervisor เปิดตัวใหม่
- **THEN** log ของ Task นั้นมี `turn.interrupted` และ `turn.ended` ที่มีเหตุผล `interrupted` และไม่มีคำสั่งใดถูกรันซ้ำ

#### Scenario: เริ่ม Runtime ใหม่
- **WHEN** Owner รัน `veeloe` ใหม่บนเครื่องที่มี Task ค้างจากครั้งก่อน
- **THEN** ทุก Turn ที่ค้างถูกปิดด้วยเหตุผล `interrupted` และ Controller เห็นว่าถูกขัดจังหวะ

#### Scenario: พิมพ์ต่อหลังถูกขัดจังหวะ
- **WHEN** Owner ส่งข้อความใหม่ใน Task ที่เพิ่งถูกปิดเพราะเริ่มใหม่
- **THEN** Turn ใหม่เริ่มได้ทันที ไม่ได้ `agent.busy`
