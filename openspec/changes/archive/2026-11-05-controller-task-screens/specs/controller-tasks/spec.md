## ADDED Requirements

### Requirement: Inbox แสดง Character และสถานะของแต่ละ Agent
แถวของ Agent ใน Inbox SHALL มี Character พร้อม Mood ของ Task ล่าสุด ชื่อ Agent ชื่อ Machine เวลาล่าสุด สถานะ และข้อความล่าสุดสองบรรทัด สถานะ SHALL เป็นหนึ่งใน กำลังทำงาน, Turn ล้มเหลว, เสร็จแล้ว, ยังไม่ได้เริ่ม หรือออฟไลน์ โดยออฟไลน์มาก่อนทุกแบบ แถว SHALL เรียง Agent ที่กำลังทำงานก่อน แล้วตามด้วยแถวที่ล้มเหลวกับเสร็จแล้วตามเวลาล่าสุด แล้วจึง Agent ที่ยังไม่ได้เริ่ม และ Agent ที่ Machine ออฟไลน์ท้ายสุด การแตะแถว SHALL เปิด Task ตรงๆ โดยไม่มีหน้าเลือกคั่น

#### Scenario: Turn ล้มเหลว
- **WHEN** Turn ล่าสุดของ Agent จบเพราะ Provider ล้มเหลว
- **THEN** แถวของ Agent ใน Inbox บอกว่า Turn ล้มเหลว ไม่ใช่เสร็จแล้ว และหัวของหน้า Task บอกเหมือนกัน

#### Scenario: Agent ที่ยังไม่มี Task
- **WHEN** Owner แตะแถวของ Agent ที่ยังไม่มี Task
- **THEN** หน้า Task ว่างของ Agent นั้นเปิดขึ้นทันที

### Requirement: ช่องพิมพ์ไม่ส่งระหว่าง Turn
ระหว่างที่ Turn ของ Task ยังไม่จบ ช่องพิมพ์ SHALL ให้พิมพ์ได้แต่ SHALL ไม่ให้กดส่ง และ SHALL บอกว่าส่งได้เมื่อ Turn นี้จบ เมื่อ Turn จบ ปุ่มส่ง SHALL กดได้อีกโดยข้อความที่พิมพ์ค้างไว้ยังอยู่ ถ้า Machine ยังตอบ `agent.busy` เพราะ Turn เริ่มจาก Controller เครื่องอื่น Controller SHALL ยังแสดงคำของ error นั้นตาม `agent-and-task`

#### Scenario: พิมพ์ระหว่าง Agent ทำงาน
- **WHEN** Owner พิมพ์ข้อความระหว่างที่ Agent ยังตอบข้อความก่อนหน้าไม่จบ
- **THEN** ปุ่มส่งกดไม่ได้ ช่องพิมพ์บอกว่าส่งได้เมื่อ Turn นี้จบ และกดส่งได้ทันทีที่ Turn จบ

### Requirement: หน้า Task มี Character ของ Agent
หัวของ log ในหน้า Task SHALL มี Character ของ Agent พร้อม Mood ของ Task นี้ ชื่อ Machine และเวลาที่ Task เริ่ม หรือคำว่ายังไม่ได้เริ่ม การแตะ Character SHALL เปิดหน้า Agent เหมือนปุ่มตั้งค่า Agent ที่หัวหน้า

#### Scenario: แตะ Character
- **WHEN** Owner แตะ Character ที่หัวของ log
- **THEN** หน้า Agent ซึ่งมีรายชื่อ Task และปุ่ม Task ใหม่เปิดขึ้น

### Requirement: จอกว้างวาง Inbox ข้าง Task
เมื่อหน้าต่างกว้างตั้งแต่ 960 จุด Controller SHALL วาง Inbox เป็นการ์ดด้านซ้ายตลอดเวลา และเปิด Task ทางขวา แถวของ Task ที่เปิดอยู่ SHALL ถูกเน้น การแตะแถวอื่น SHALL แทนที่ Task ที่เปิดอยู่โดยไม่ซ้อนหน้า หน้าแรกทางขวา SHALL บอกให้เลือก Agent ทางซ้าย การย่อหรือขยายหน้าต่าง SHALL ไม่ทำให้หน้าที่เปิดอยู่หายไป

#### Scenario: เว็บบนคอม
- **WHEN** Owner เปิดแอปบนเว็บในหน้าต่างกว้าง แล้วแตะ Agent สองตัวต่อกัน
- **THEN** Inbox อยู่ทางซ้ายตลอด Task ของตัวที่สองแทนที่ตัวแรก และปุ่มย้อนกลับไม่พาไปที่ Task แรก

#### Scenario: ย่อหน้าต่าง
- **WHEN** Owner ย่อหน้าต่างให้แคบกว่า 960 จุดระหว่างที่เปิด Task อยู่
- **THEN** Inbox ด้านซ้ายหายไป Task เดิมยังเปิดอยู่ และย้อนกลับไปที่ Inbox ได้
