# agent-deletion Specification

## Purpose
กำหนดการลบ Agent จาก Controller และ Runtime โดยเก็บ Workdir กับ Task history ไว้ และให้ Controller ลบแถว local เมื่อ Machine ยืนยันรายการใหม่

คำศัพท์: **Agent deletion** คือการเอา Agent ออกจาก registry/worker/route; **Workdir** คือ `<VEELOE_HOME>/agents/<id>/workdir`; **Task history** คือ event log ที่ยังอยู่ใน `tasks.db`

## Requirements

### Requirement: Owner หรือ Member ที่มี Manage ลบ Agent ได้
Controller SHALL ส่ง `agent.delete` ที่มี `id` หลังผู้ใช้ยืนยันและยืนยันตัวใหม่; Runtime MUST อนุญาตเฉพาะ Owner หรือ Member ที่มี `manage` ที่ Agent นั้น; ผู้ที่ไม่มีสิทธิ์ MUST ถูกปฏิเสธก่อนหยุด worker

#### Scenario: Owner ลบ Agent
- **WHEN** Owner กดลบ Agent และยืนยัน
- **THEN** Runtime หยุด worker, ลบ Agent ออกจาก registry และตอบรายการใหม่

#### Scenario: Member ไม่มี Manage
- **WHEN** Member ที่ไม่มี `manage` ที่ Agent ส่ง `agent.delete`
- **THEN** Runtime ปฏิเสธและ Agent ยังทำงาน

#### Scenario: Agent ไม่มีอยู่
- **WHEN** ส่ง `agent.delete` ด้วย id ที่ไม่มีใน registry
- **THEN** Runtime ตอบ `agent.unknown` และไม่เปลี่ยนอะไร

### Requirement: ลบ Agent แล้ว Workdir และ Task history ยังอยู่

Runtime MUST NOT ลบ Workdir หรือ Task history เมื่อลบ Agent; Agent ที่ลบแล้ว MUST ไม่ปรากฏใน `agents` ของ `agent.listed`, MUST ปรากฏใน `trash` พร้อม `deletedAt` กับ `restoreUntil`, และ MUST ไม่รับงานใหม่; Task เดิม MUST ยังเปิดอ่านได้

#### Scenario: Workdir ยังอยู่
- **WHEN** Agent ถูกลบ
- **THEN** โฟลเดอร์ `agents/<id>/workdir` ยังอยู่บนดิสก์

#### Scenario: Task เดิมยังเปิดได้
- **WHEN** ผู้ใช้เปิด Task ที่เคยเป็นของ Agent ที่ถูกลบ
- **THEN** หน้า Task ยังแสดงประวัติเดิมโดยไม่ crash

#### Scenario: Agent หายจากรายการหลักแต่ยังอยู่ในถังขยะ
- **WHEN** Agent ถูกลบและยังไม่ครบ 30 วัน
- **THEN** `agent.listed` ไม่มี Agent นั้นใน `agents` แต่มีใน `trash`

### Requirement: Controller ลบแถว local ตามรายการจาก Machine

Controller MUST NOT ลบ Agent local ก่อน Machine ยืนยัน; เมื่อได้ `agent.listed` ที่ไม่มี id เดิมใน `agents` Controller MUST เอาแถวนั้นออกจากตาราง `agent` และ MUST เก็บข้อมูลที่ Machine ส่งมาใน `trash` ไว้ในตาราง `agent_trash`; เมื่อ id นั้นกลับมาอยู่ใน `agents` Controller MUST ลบแถวนั้นออกจาก `agent_trash`

#### Scenario: ลบสำเร็จ
- **WHEN** Machine ตอบ `agent.listed` โดยที่ Agent ที่เพิ่งลบไม่อยู่ใน `agents` แต่อยู่ใน `trash`
- **THEN** Agent หายจากรายการหลักและปรากฏใน section ถังขยะของ Controller

#### Scenario: Machine ปฏิเสธ
- **WHEN** Machine ตอบ error แทน `agent.listed`
- **THEN** Agent ยังอยู่ในรายการ local และแสดง error

#### Scenario: กู้คืนแล้วย้ายกลับ
- **WHEN** Machine ตอบ `agent.listed` ที่มี Agent นั้นใน `agents` และไม่มีใน `trash`
- **THEN** Controller ย้ายแถวกลับไปตาราง `agent` และลบออกจาก `agent_trash`
