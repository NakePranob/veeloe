# Spec Delta

## ADDED Requirements

### Requirement: ช่องพิมพ์เสนอ Stop ขณะ Agent กำลังทำและยังไม่มีข้อความ
หน้า Task SHALL แสดงปุ่ม **หยุด** แทนปุ่มส่งเมื่อ Turn ของ Task กำลังทำอยู่และช่องพิมพ์ว่าง และ SHALL กลับไปเป็นปุ่มส่งทันทีที่มีข้อความ ตาม controller-prototype's Composer การกดหยุด SHALL ถามยืนยันก่อนพร้อมบอกว่าจะหยุดอะไร ("จะหยุด: • {{Agent}} · {{Task}}") และบอกว่าไฟล์ที่แก้ไปแล้วยังอยู่กับคุยต่อได้ ปุ่มยืนยัน SHALL เป็นแบบทำลาย (destructive) ระหว่างรอ Machine ตอบ SHALL แสดงว่ากำลังหยุด และเมื่อได้ error SHALL แสดงคำของ code นั้น คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: กดหยุด
- **WHEN** Agent กำลังทำ Turn อยู่และช่องพิมพ์ว่าง แล้ว Owner กดปุ่มหยุดและยืนยัน
- **THEN** Controller ส่ง `task.stop` ของ Task นั้น และเมื่อ log มี `turn.ended` หน้า Task แสดงว่าจบแล้ว

#### Scenario: พิมพ์ค้างไว้
- **WHEN** Owner พิมพ์ข้อความระหว่างที่ Agent กำลังทำ
- **THEN** ปุ่มที่เห็นเป็นปุ่มส่ง ไม่ใช่ปุ่มหยุด

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ออฟไลน์อยู่
- **THEN** ปุ่มหยุดกดไม่ได้ และหน้า Task บอกว่า Machine ต้องออนไลน์

### Requirement: หน้า Task บอกว่าใครหยุด และบอกว่า Turn ถูกขัดจังหวะ
หน้า Task SHALL แสดง `turn.stopped` เป็นบรรทัดกลางจอว่า "{{member}} หยุด Turn นี้ · {{when}}" กับไอคอนหยุด และ SHALL แสดง `turn.interrupted` เป็นการ์ดที่บอกว่า Machine เริ่มใหม่กลาง Turn ว่าไฟล์ที่แก้ไว้ยังอยู่และ Agent จะไม่ทำต่อเองเพราะอาจรันคำสั่งเดิมซ้ำ พร้อมปุ่ม **ทำต่อ** ที่ส่งข้อความ "ทำต่อ" ใน Task เดิม คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: เห็นว่าใครหยุด
- **WHEN** log มี `turn.stopped` ของ Owner
- **THEN** หน้า Task แสดงบรรทัดว่า Owner หยุด Turn นี้พร้อมเวลา

#### Scenario: กดทำต่อ
- **WHEN** Owner กดปุ่มทำต่อบนการ์ด Turn ถูกขัดจังหวะ
- **THEN** ข้อความ "ทำต่อ" ถูกส่งใน Task เดิม และ Turn ใหม่เริ่ม

### Requirement: Inbox และหัว Task แสดงสถานะ Turn ถูกขัดจังหวะ
สถานะของ Task SHALL มีค่า `interrupted` ที่แสดงคำว่า "Turn ถูกขัดจังหวะ" และแถวของ Agent ใน Inbox กับหัวหน้า Task SHALL ใช้ค่านี้เมื่อ event ล่าสุดที่รู้จักคือ `turn.interrupted` หรือ Turn ที่จบด้วยเหตุผล `interrupted` สถานะนี้ SHALL ไม่ทับสถานะรออนุมัติหรือกำลังทำ ซึ่งมาก่อนเสมอ

#### Scenario: หลังเริ่มใหม่
- **WHEN** Turn ล่าสุดจบด้วยเหตุผล `interrupted`
- **THEN** แถวของ Agent ใน Inbox และหัวหน้า Task แสดง "Turn ถูกขัดจังหวะ"
