## ADDED Requirements

### Requirement: อ่าน Memory ของ Agent ผ่านข้อความที่เซ็นแล้ว

Controller SHALL ขอ Memory ด้วย `memory.get` ที่มี `request` กับ `agent`; Runtime SHALL ตอบ `memory.got` ที่มี `request` เดิม, `agent`, `exists`, `chars` และ `text` โดย `text` MUST เป็นข้อความชุดเดียวกับที่ Turn ถัดไปได้รับ (ตัดตามเพดานเดียวกับ prompt พร้อมข้อความให้ย่อเมื่อเกิน) และ `chars` MUST เป็นจำนวนตัวอักษรของไฟล์ทั้งหมด Runtime MUST NOT สร้างไฟล์หรือโฟลเดอร์ใด ๆ จากการอ่าน Agent ที่ไม่รู้จัก SHALL ได้ error `agent.unknown`; Agent ที่อยู่ในถังขยะ SHALL อ่านได้

#### Scenario: Agent ที่มี Memory
- **WHEN** Controller ส่ง `memory.get` ให้ Agent ที่มี `MEMORY.md`
- **THEN** Runtime ตอบ `memory.got` ที่มี `request` เดิม, `exists` เป็นจริง, จำนวนตัวอักษรทั้งไฟล์ และ `text` ที่ตรงกับ prompt

#### Scenario: ยังไม่มีไฟล์
- **WHEN** Controller ส่ง `memory.get` ให้ Agent ที่ยังไม่มี `MEMORY.md`
- **THEN** Runtime ตอบ `memory.got` ที่ `exists` เป็นเท็จ, `chars` เป็น 0 และ `text` ว่าง และไม่มีไฟล์หรือโฟลเดอร์ใหม่เกิดขึ้น

#### Scenario: ไฟล์ยาวเกินเพดาน
- **WHEN** `MEMORY.md` ยาวกว่า 4,000 ตัวอักษร
- **THEN** `text` มี 4,000 ตัวแรกตามด้วยข้อความให้ย่อ และ `chars` ยังเป็นจำนวนตัวอักษรทั้งหมด

#### Scenario: Agent ที่ไม่รู้จัก
- **WHEN** Controller ส่ง `memory.get` ด้วย id ที่ไม่มีใน `agents.json`
- **THEN** Runtime ตอบ error `agent.unknown`

#### Scenario: Agent ในถังขยะ
- **WHEN** `memory.get` อ้างถึง Agent ที่มี `deletedAt`
- **THEN** Runtime ตอบ `memory.got` ตามปกติ
