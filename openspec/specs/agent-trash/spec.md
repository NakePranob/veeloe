# agent-trash Specification

## Purpose
กำหนดการเก็บ Agent ที่ถูกลบไว้ 30 วันบน Machine การกู้คืน และการตัดแถวออกเมื่อหมดอายุ โดยไม่แตะ Workdir และ Task history

คำศัพท์: **Agent ที่ถูกลบ (trashed Agent)** คือ Agent ที่ยังมีแถวใน `agents.json` แต่มี `deletedAt`; **`restoreUntil`** คือ `deletedAt` บวก 30 วัน เป็น epoch milliseconds; **purge** คือการเอาแถวออกจาก `agents.json` โดยไม่ลบ Workdir หรือ `tasks.db`

## Requirements

### Requirement: Agent ที่ถูกลบต้องอยู่ในถังขยะ 30 วัน

เมื่อ Owner ลบ Agent Runtime MUST เก็บแถวของ Agent นั้นไว้ใน `agents.json` พร้อม `deletedAt` และหยุด Worker ทันที; Runtime MUST NOT ลบแถวนั้นก่อนครบ 30 วันนับจาก `deletedAt` และ MUST NOT แตะ Workdir หรือ Task history ของ Agent นั้น

`restoreUntil` คือ `deletedAt` บวก 30 วัน เป็น epoch milliseconds; Runtime เป็นผู้คำนวณและส่งมาใน `agent.listed`

#### Scenario: ลบ Agent ที่มี Task history
- **WHEN** Owner ลบ Agent ที่มี Task history และ Runtime ตรวจสิทธิ์ผ่าน
- **THEN** Worker หยุด, Agent หายจาก `agents` ใน `agent.listed` แต่ปรากฏใน `trash` พร้อม `deletedAt` และ `restoreUntil`, และ `tasks.db` ยังอยู่

#### Scenario: ยังไม่ครบ 30 วัน
- **WHEN** ผ่านไป 29 วันนับจาก `deletedAt` และ Controller ขอ `agent.list`
- **THEN** Agent ยังอยู่ใน `trash` และกู้คืนได้

#### Scenario: ครบ 30 วันแล้ว
- **WHEN** ครบ 30 วันนับจาก `deletedAt` ไม่ว่าจะด้วยการเปิด Runtime ใหม่หรือการขอ `agent.list`
- **THEN** Runtime เอาแถวออกจาก `agents.json` โดย Workdir และ `tasks.db` ยังอยู่บนดิสก์

#### Scenario: Runtime เริ่มทำงานใหม่ระหว่างที่ Agent อยู่ในถังขยะ
- **WHEN** Runtime ถูกปิดแล้วเปิดใหม่ตอนที่ Agent ยังไม่ครบ 30 วัน
- **THEN** Runtime ไม่สตาร์ท Worker ของ Agent นั้น และ Agent ยังอยู่ใน `trash`

#### Scenario: ลบซ้ำขณะอยู่ในถังขยะ
- **WHEN** Controller ส่ง `agent.delete` ให้ Agent ที่อยู่ในถังขยะแล้ว
- **THEN** `deletedAt` เดิมไม่เปลี่ยน และวันหมดอายุไม่ถูกเลื่อนออกไป

#### Scenario: แก้ setting ของ Agent ในถังขยะ
- **WHEN** Controller ส่ง `agent.update` ให้ Agent ที่อยู่ในถังขยะ
- **THEN** Runtime ตอบ `agent.unknown` และไม่เปลี่ยน setting เดิม

### Requirement: กู้คืน Agent ที่อยู่ในถังขยะได้

Controller MUST ส่ง `agent.restore` ที่มี `id`; Runtime MUST กู้คืนเมื่อ Agent นั้นมีอยู่และยังไม่ครบ 30 วัน, MUST ตอบ `agent.listed` แบบไม่เปลี่ยนอะไรเมื่อ Agent นั้นยังไม่ถูกกัก, และ MUST ตอบ `agent.unknown` เมื่อ Agent ไม่มีอยู่หรือครบ 30 วันแล้ว

กู้คืน MUST ทำให้ Agent กลับไปอยู่ใน `agents`, `trash` ไม่มี id นั้น, และ Worker เริ่มทำงานใหม่ด้วย settings เดิม

#### Scenario: กู้คืนสำเร็จ
- **WHEN** Owner กดกู้คืน Agent ที่อยู่ในถังขยะภายใน 30 วัน
- **THEN** Agent กลับไปอยู่ใน `agents` พร้อม settings เดิม, `trash` ไม่มี id นั้น และ Worker เริ่มทำงาน

#### Scenario: กดกู้คืนซ้ำ
- **WHEN** Controller ส่ง `agent.restore` สองครั้งสำหรับ Agent เดียวกัน
- **THEN** คำขอที่สองไม่เปลี่ยนอะไรและได้ `agent.listed` ที่มี Agent นั้นใน `agents` ครั้งเดียว

#### Scenario: กู้คืนหลังหมดอายุ
- **WHEN** Controller ส่ง `agent.restore` ให้ Agent ที่ครบ 30 วันแล้ว
- **THEN** Runtime ตอบ `agent.unknown` และ Agent ไม่กลับไปอยู่ใน `agents`

### Requirement: Agent ในถังขยะต้องไม่รับงานและไม่กิน Budget

Runtime MUST ปฏิเสธ `task.message`, `task.sync` และ `task.stop` ที่เล็ง Agent ที่อยู่ในถังขยะด้วย `agent.unknown`, MUST ไม่ให้ Agent นั้นใช้ proxy ของ Provider แม้แถวจะยังอยู่ใน `agents.json`, และ MUST ไม่นับ Budget ของ Agent นั้นในยอดของ Machine

#### Scenario: ส่งข้อความถึง Agent ในถังขยะ
- **WHEN** Controller ส่ง `task.message` ที่เล็ง Agent ที่อยู่ในถังขยะ
- **THEN** Runtime ตอบ `agent.unknown` โดยไม่ส่งต่อไปยัง Worker

#### Scenario: sync หรือ stop Task ของ Agent ในถังขยะ
- **WHEN** Controller ส่ง `task.sync` หรือ `task.stop` ที่เล็ง Agent ซึ่งอยู่ในถังขยะ
- **THEN** Runtime ตอบ `agent.unknown` โดยไม่รอ Worker ที่ไม่มีอยู่

#### Scenario: เรียก LLM ผ่าน Agent ในถังขยะ
- **WHEN** มีคำขอใช้ proxy ของ Provider ที่อ้าง Agent ซึ่งอยู่ในถังขยะ
- **THEN** proxy ปฏิเสธและไม่มี token ถูกใช้

#### Scenario: ยอด Budget ของ Machine
- **WHEN** Machine มี Agent ที่ใช้งานอยู่หนึ่งตัวและ Agent ในถังขยะที่ตั้ง Budget ไว้
- **THEN** `machine.status` นับเฉพาะ Budget ของ Agent ที่ใช้งานอยู่

### Requirement: Controller แสดงถังขยะและกู้คืนได้

Controller MUST แสดง Agent ที่อยู่ใน `trash` ใน section "Agent ที่ถูกลบ" ใต้รายการ Agent พร้อมรูป Character, วันเหลือ และปุ่มกู้คืน; Controller MUST ลบ section นี้เมื่อ Machine ไม่ส่ง `trash` มา และ MUST ไม่แสดง Agent ที่อยู่ในถังขยะในรายการ Agent, Inbox หรือหน้า Machine

#### Scenario: เปิดหน้ารายการ Agent หลังลบ
- **WHEN** Controller ได้ `agent.listed` ที่มี Agent หนึ่งตัวใน `trash`
- **THEN** หน้ารายการ Agent แสดง Agent นั้นใน section ถังขยะพร้อมรูป Character และวันเหลือ ไม่ใช่ในรายการหลัก

#### Scenario: Machine รุ่นเก่า
- **WHEN** Controller ได้ `agent.listed` ที่ไม่มี field `trash`
- **THEN** Controller ไม่แสดง section ถังขยะ และพฤติกรรมการลบเป็นแบบเดิม

#### Scenario: กู้คืนจากหน้า Agent
- **WHEN** Owner กดกู้คืนแล้ว Machine ตอบ `agent.listed` ที่มี Agent นั้นใน `agents`
- **THEN** Agent กลับไปอยู่ในรายการหลักและหายจาก section ถังขยะ

### Requirement: หน้า Task ของ Agent ในถังขยะยังอ่านได้

หน้า Task ของ Agent ที่อยู่ในถังขยะ MUST เปิดอ่านประวัติเดิมได้ MUST แสดงชื่อจริงของ Agent จากถังขยะ และ MUST ไม่ให้ส่งข้อความใหม่จนกว่าจะกู้คืน

#### Scenario: เปิด Task ของ Agent ที่ถูกลบ
- **WHEN** ผู้ใช้เปิด Task ที่เป็นของ Agent ซึ่งอยู่ในถังขยะ
- **THEN** หน้า Task แสดงประวัติเดิมพร้อมชื่อจริงของ Agent และไม่มีช่องส่งข้อความ
