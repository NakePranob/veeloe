# agent-grants Specification

## Purpose

Grant คือสิทธิ์ของ Member หนึ่งคนที่ Agent หนึ่งตัว มีสามระดับ Use, Approve และ Manage ระดับที่สูงกว่าทำได้ทุกอย่างที่ระดับต่ำกว่าทำได้ Owner มี Manage ที่ทุก Agent โดยไม่ต้องมี Grant Runtime เก็บ Grant ที่เซ็นไว้บน Machine และตรวจทุกคำสั่งจาก Grant เอง ไม่ถาม Hub (ADR 0010, 0031)

## Requirements

### Requirement: ให้และถอน Grant ด้วยคำสั่งที่เซ็น
Runtime SHALL รับ `grant.set` ที่มี `agent`, `member` และ `level` (`use`, `approve`, `manage` หรือ `none` เพื่อถอน) เฉพาะเมื่อผู้เซ็นเป็น Owner หรือมี Manage ที่ Agent นั้น Runtime SHALL ปฏิเสธ Grant ที่ให้กับ Owner (`grant.owner`), Member ที่ Machine ไม่รู้จัก (`grant.unknown_member`) และ Agent ที่ไม่มีหรืออยู่ในถังขยะ (`agent.unknown`) Runtime SHALL เก็บ Grant ใน `trust.json` และตอบผู้ส่งด้วย `grants.listed` ที่มี Grant ทั้งหมดของ Agent นั้น

#### Scenario: Owner ให้ Use
- **WHEN** Owner ส่ง `grant.set` ให้ `member-2` ได้ `use` ที่ `shared`
- **THEN** `trust.json` มี Grant นั้น และ Owner ได้ `grants.listed` ที่มี `member-2` ระดับ `use`

#### Scenario: คนที่มีแค่ Use ให้สิทธิ์ต่อ
- **WHEN** Member ที่มี Use ที่ `shared` ส่ง `grant.set` ที่ `shared`
- **THEN** Runtime ตอบ `grant.forbidden` และไม่เปลี่ยนอะไร

#### Scenario: Manager ให้สิทธิ์ที่ Agent อื่น
- **WHEN** Member ที่มี Manage ที่ `shared` ส่ง `grant.set` ที่ `private`
- **THEN** Runtime ตอบ `grant.forbidden`

### Requirement: Member ที่ไม่ใช่ Owner ทำได้แค่ตาม Grant
Runtime SHALL ตอบคำสั่งเกี่ยวกับ Task ของ Agent ใดจาก Member ที่ไม่มี Use ที่ Agent นั้นด้วย `agent.forbidden` Runtime SHALL ตอบคำสั่งที่ยังไม่ตรวจ Grant ต่อ Agent (เช่น `agent.list`, `agent.create`, `provider.add`) จาก Member ที่ไม่ใช่ Owner ด้วย `member.forbidden` Grant ที่ถอนแล้ว SHALL มีผลตั้งแต่คำสั่งถัดไป

#### Scenario: ไม่มี Grant
- **WHEN** Member ที่ไม่มี Grant ส่ง `task.message` ถึง `shared`
- **THEN** Runtime ตอบ `agent.forbidden` และไม่มี Turn

#### Scenario: มี Use
- **WHEN** Member ที่มี Use ที่ `shared` ส่ง `task.message` ถึง `shared`
- **THEN** Turn เริ่มและจบ และ event ของ Task ไปถึง Member คนนั้น

#### Scenario: ถอนแล้ว
- **WHEN** Owner ถอน Grant ของ Member แล้ว Member ส่ง `task.message` อีกครั้ง
- **THEN** Runtime ตอบ `agent.forbidden`

### Requirement: กุญแจของคนหนึ่งไม่ใช้สิทธิ์ของอีกคน
Runtime SHALL ให้สิทธิ์ตามคู่ของ Member กับกุญแจที่เซ็น ซองที่อ้างชื่อ Member คนหนึ่งแต่เซ็นด้วยกุญแจของอีกคน SHALL ไม่ได้สิทธิ์ของคนที่อ้าง Member ที่ไม่ใช่ Owner SHALL ผูกเครื่องเพิ่มของตัวเองด้วย `device.link` ได้เหมือน Owner

#### Scenario: อ้างชื่อ Owner ด้วยกุญแจของ Member
- **WHEN** ซองอ้าง `member-1` ที่เป็น Owner แต่เซ็นด้วยกุญแจของ `member-2`
- **THEN** Runtime ไม่ให้สิทธิ์ของ Owner
