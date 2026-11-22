## ADDED Requirements

### Requirement: Mood ค้างเมื่อ Runtime บอกว่า Turn ค้าง
Character SHALL มี Mood ค้าง เมื่อ event ล่าสุดที่รู้จักของ Task คือ `turn.stalled` Mood ออฟไลน์ SHALL มาก่อนค้าง และค้าง SHALL มาก่อนคิดและทำงาน Mood ค้าง SHALL หายเองเมื่อมี event ถัดไปของ Turn โดยไม่ต้องมี event แยก Controller SHALL ไม่ตัดสินเองว่า Turn ค้างจากเวลา แถวของ Agent ใน Inbox และ header ของหน้า Task SHALL มีคำบอกว่า Turn ค้างคู่กับ Mood นี้ เมื่อเครื่องตั้งให้ลดการเคลื่อนไหว Character SHALL อยู่นิ่งในท่าค้าง

#### Scenario: Provider ไม่ตอบ
- **WHEN** Runtime เขียน `turn.stalled` ใน Task ที่ Owner เปิดอยู่
- **THEN** Character ใน Inbox และใน header เปลี่ยนเป็นค้าง พร้อมคำว่า Turn ค้าง

#### Scenario: เดินต่อหลังค้าง
- **WHEN** หลัง `turn.stalled` มี `llm.message` เข้ามาใน Turn เดียวกัน
- **THEN** Character กลับเป็นคิดหรือทำงานตาม event นั้น

#### Scenario: Machine หลุดระหว่างค้าง
- **WHEN** event ล่าสุดคือ `turn.stalled` และ Hub บอกว่า Machine ออฟไลน์
- **THEN** Character เป็นออฟไลน์ ไม่ใช่ค้าง
