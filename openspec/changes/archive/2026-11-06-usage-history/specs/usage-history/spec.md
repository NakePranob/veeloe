## ADDED Requirements

### Requirement: Machine เก็บประวัติการใช้ token เป็นแถวต่อ Agent วัน แหล่งที่มา และ Task

supervisor SHALL เก็บยอดทุกคำตอบที่ถูกนับเป็นแถวใน SQLite ใต้โฟลเดอร์ของ supervisor โดยมี Agent, วันของ Budget, แหล่งที่มา, รหัส Task และจำนวน token วัน SHALL มาจาก `budgetDay` และแหล่งที่มา SHALL เป็น `task` ใน v0.1 รหัส Task SHALL มาจากหัว `x-veeloe-task` หรือเป็นสตริงว่างเมื่อไม่มี ประวัติ MUST NOT มีเนื้อหาแชต ชื่อไฟล์ หรือคำตอบของ Provider ไฟล์ SHALL เป็นของเจ้าของเครื่องเท่านั้น และยอด SHALL อยู่รอดเมื่อ supervisor เริ่มใหม่

#### Scenario: สอง Task ในวันเดียว
- **WHEN** Agent เดียวคุยสอง Task ในวันเดียวกัน แล้วแต่ละคำตอบถูกรายงาน `usage`
- **THEN** ที่เก็บมีหนึ่งแถวต่อ Task และยอดของวันนั้นคือผลรวมของทั้งสองแถว

#### Scenario: คำตอบที่ gateway ไม่รายงาน usage
- **WHEN** Provider ตอบโดยไม่มี `usage`
- **THEN** ไม่มีแถวใหม่ และยอดของวันนั้นไม่เปลี่ยน

#### Scenario: เริ่ม supervisor ใหม่ในวันเดียวกัน
- **WHEN** supervisor เริ่มใหม่หลังใช้ไป 2M ตอนเช้า
- **THEN** ยอดของวันนี้ยังเป็น 2M และยังตอบช่วงวันที่ได้เหมือนเดิม

### Requirement: เก็บ 30 วันและใช้ยอดจากที่เก็บเดียวกับ Budget

supervisor SHALL เก็บประวัติ 30 วันรวมวันนี้ และ SHALL ลบแถวที่เก่ากว่าตอนเปิดและเมื่อวันของ Budget เปลี่ยน ยอดของวันนี้ที่ใช้บังคับ Budget SHALL เป็นผลรวมของแถวในที่เก็บเดียวกัน MUST NOT มี `usage.json` เป็นยอดที่สอง และเมื่อที่เก็บยังว่าง supervisor SHALL นำเข้าจาก `usage.json` ครั้งเดียวแล้วเลิกอ่านไฟล์นั้น

#### Scenario: ข้ามวันที่ 31
- **WHEN** เปิด supervisor ในวันที่ 31 หลังมีแถวของวันที่ 1
- **THEN** แถวของวันที่ 1 ถูกลบและไม่ถูกนับในยอดของวันนี้

#### Scenario: ยอดเดิมจาก `usage.json`
- **WHEN** เปิด supervisor ครั้งแรกหลังเปลี่ยนที่เก็บ โดยมี `usage.json` ของวันนี้อยู่
- **THEN** ยอดนั้นกลายเป็นแถวของวันนี้ และการนับครั้งต่อไปบวกเข้ายอดเดิม ไม่ทับ

#### Scenario: count_tokens
- **WHEN** worker ขอ `POST /v1/messages/count_tokens`
- **THEN** ไม่มีแถวใหม่และยอดไม่เปลี่ยน

### Requirement: `usage.list` ตรวจคำขอและสิทธิ์

supervisor SHALL รับ `usage.list` ที่เซ็นด้วยกุญแจใน trust และผู้ขอ SHALL มี Manage ที่ Agent ที่ระบุ คำขอ SHALL มี `days` เป็นจำนวนเต็ม 1 ถึง 90 และ Machine SHALL คำนวณ `from` กับ `to` จากวันของ Budget ของตัวเอง แล้วส่งกลับในคำตอบ สิ่งที่ไม่ผ่าน SHALL ได้ error `usage.invalid_range` และ Agent ที่ระบุแต่ไม่มีหรือไม่มี Manage SHALL ได้ error `agent.unknown`

#### Scenario: จำนวนวันไม่ถูกต้อง
- **WHEN** คำขอมี `days` เป็น 0, 91 หรือไม่ใช่จำนวนเต็ม
- **THEN** ผู้ขอได้ error `usage.invalid_range`

#### Scenario: Agent ที่ไม่มีหรือไม่มี Manage
- **WHEN** คำขอระบุ Agent ที่ Machine ไม่มี หรือผู้ขอไม่มี Manage ที่ Agent นั้น
- **THEN** ผู้ขอได้ error `agent.unknown`

#### Scenario: ช่วงที่ได้ตามนาฬิกาของ Machine
- **WHEN** Owner ขอ `days` 7 ขณะมือถืออยู่อีกเขตเวลาหนึ่ง
- **THEN** `from` กับ `to` ในคำตอบเป็นวันของ Budget ตามเวลาของ Machine ไม่ใช่ของมือถือ

### Requirement: `usage.listed` มีขอบเขตและไม่เติมวันว่าง

supervisor SHALL ตอบ `usage.listed` ที่มี `request` เดิม, `from`, `to` และรายการ Agent โดยแต่ละ Agent SHALL มีผลรวมรายวันเฉพาะวันที่มีแถว, Task ที่ใช้ token มากที่สุด 20 อัน และผลรวมตามแหล่งที่มา คำตอบ MUST NOT มีเนื้อหาหรือข้อมูลของ Provider และ SHALL ส่งถึงผู้ขอคนเดียว

#### Scenario: ขอ 30 วันที่มีข้อมูล 3 วัน
- **WHEN** Owner ขอ `days` 30 ขณะ Agent มีแถวอยู่ 3 วัน
- **THEN** `usage.listed` มี `days` 3 รายการ ไม่เติมวันที่ไม่มีข้อมูลเป็นศูนย์

#### Scenario: วันที่มีช่องว่างจาก gateway
- **WHEN** วันหนึ่งมีคำตอบแต่ gateway ไม่รายงาน `usage`
- **THEN** วันนั้นไม่มีใน `days` และแอปแสดงเป็นช่องว่าง ไม่ใช่ 0

#### Scenario: คำตอบกลับไปหาคนที่ถามและพา request เดิมมา
- **WHEN** Member หนึ่งขอ `usage.list` ขณะมีคำขออื่นค้างอยู่
- **THEN** คำตอบมี `request` ตรงกับคำขอของเขาและส่งถึงเขาเท่านั้น
