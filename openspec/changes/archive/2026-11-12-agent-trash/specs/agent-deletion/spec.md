## MODIFIED Requirements

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
