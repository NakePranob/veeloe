## MODIFIED Requirements

### Requirement: Owner คุยกับ Agent ใน Task
การแตะแถวของ Agent ใน Inbox SHALL เปิด Task ล่าสุดของ Agent นั้น หรือ Task ใหม่ถ้ายังไม่มี หน้า Task SHALL แสดงข้อความของ Owner และข้อความที่ Agent ตอบตามลำดับของ event ปุ่มที่หัวหน้า Task SHALL เปิดหน้า Agent ซึ่งมีรายชื่อ Task ของ Agent นั้นและปุ่ม Task ใหม่ ระหว่าง Turn Controller SHALL แสดงว่า Agent กำลังทำงาน error ทุกตัวที่ได้ SHALL แสดงเป็นคำในภาษาของ Owner ตาม code (ADR 0065) Turn ของ Task อื่นที่กำลังทำ SHALL ไม่ห้ามการส่งข้อความเข้า Task นี้

#### Scenario: ส่งข้อความ
- **WHEN** Owner พิมพ์แล้วกดส่ง
- **THEN** ข้อความขึ้นทันทีว่ากำลังส่ง แล้วคำตอบของ Agent ขึ้นต่อท้ายเมื่อ LLM ตอบเสร็จแต่ละครั้ง

#### Scenario: Agent ไม่ว่าง
- **WHEN** Owner ส่งข้อความเข้า Task ที่ไม่มี Turn ค้าง ระหว่างที่ Agent ทำ Turn ของ Task อื่น
- **THEN** ข้อความถูกส่ง และคำตอบของ Agent ใน Task นี้ขึ้นโดยไม่รอ Task อื่นจบ

#### Scenario: Turn จบด้วย error
- **WHEN** Turn จบเพราะ Provider ล้มเหลว
- **THEN** Task แสดงคำที่บอกว่าเป็นที่ Provider ในภาษาของ Owner และพิมพ์ต่อได้

#### Scenario: Task ใหม่
- **WHEN** Owner กด Task ใหม่ในหน้า Agent
- **THEN** หน้า Task ว่างเปิดขึ้น และข้อความแรกเริ่ม Task ใหม่บน Machine

### Requirement: Inbox แสดง Character และสถานะของแต่ละ Agent
แถวของ Agent ใน Inbox SHALL มี Character พร้อม Mood ของ Task ล่าสุด ชื่อ Agent ชื่อ Machine เวลาล่าสุด สถานะ และข้อความล่าสุดสองบรรทัด สถานะ SHALL เป็นหนึ่งใน กำลังทำงาน, Turn ล้มเหลว, เสร็จแล้ว, ยังไม่ได้เริ่ม หรือออฟไลน์ โดยออฟไลน์มาก่อนทุกแบบ Agent SHALL นับว่ากำลังทำงานเมื่อมี Task ใดของ Agent นั้นที่ Turn ยังไม่จบ ไม่ใช่เฉพาะ Task ล่าสุด และเมื่อ Task ที่กำลังทำงานไม่ใช่ Task ล่าสุด แถว SHALL ใช้ Mood และข้อความของ Task ที่กำลังทำงานที่ใหม่สุด แถว SHALL เรียง Agent ที่กำลังทำงานก่อน แล้วตามด้วยแถวที่ล้มเหลวกับเสร็จแล้วตามเวลาล่าสุด แล้วจึง Agent ที่ยังไม่ได้เริ่ม และ Agent ที่ Machine ออฟไลน์ท้ายสุด การแตะแถว SHALL เปิด Task ตรงๆ โดยไม่มีหน้าเลือกคั่น

Inbox SHALL มีแท็บสี่แท็บ: ทั้งหมด, รอคุณ, ทำงาน และเสร็จ แท็บทั้งหมด SHALL แสดงทุก Agent ตามลำดับข้างต้น แท็บรอคุณ SHALL แสดง Agent ที่มี Approval รออยู่ Turn ล้มเหลว หรือ Turn ถูกขัดจังหวะ แท็บทำงาน SHALL แสดง Agent ที่กำลังทำงาน และแท็บเสร็จ SHALL แสดง Agent ที่เสร็จแล้ว Agent ที่ยังไม่ได้เริ่มหรือออฟไลน์ SHALL อยู่ในแท็บทั้งหมดเท่านั้น ภายในแต่ละแท็บ SHALL ใช้ลำดับเดียวกับแท็บทั้งหมด แท็บรอคุณและทำงาน SHALL บอกจำนวน Agent ในแท็บนั้น และจำนวนของแท็บรอคุณ SHALL ใช้สีส้ม แท็บที่ไม่มี Agent SHALL บอกว่าไม่มี Agent ในสถานะนั้น Inbox SHALL เปิดที่แท็บทั้งหมดทุกครั้งที่เปิดแอป และ SHALL จำแท็บที่เลือกไว้ระหว่างที่แอปยังเปิดอยู่

#### Scenario: Turn ล้มเหลว
- **WHEN** Turn ล่าสุดของ Agent จบเพราะ Provider ล้มเหลว
- **THEN** แถวของ Agent ใน Inbox บอกว่า Turn ล้มเหลว ไม่ใช่เสร็จแล้ว และหัวของหน้า Task บอกเหมือนกัน

#### Scenario: Task เก่ายังทำอยู่
- **WHEN** Task ล่าสุดของ Agent จบแล้ว แต่ Task ที่เปิดก่อนหน้ายังมี Turn ทำอยู่
- **THEN** แถวของ Agent บอกว่ากำลังทำงาน อยู่ในแท็บทำงาน และแสดง Mood กับข้อความของ Task ที่ยังทำอยู่

#### Scenario: Agent ที่ยังไม่มี Task
- **WHEN** Owner แตะแถวของ Agent ที่ยังไม่มี Task
- **THEN** หน้า Task ว่างของ Agent นั้นเปิดขึ้นทันที

#### Scenario: Approval รออยู่ระหว่างดูแท็บอื่น
- **WHEN** Owner อยู่ที่แท็บเสร็จ และ Agent ตัวหนึ่งขอ Approval
- **THEN** จำนวนบนแท็บรอคุณเพิ่มขึ้นหนึ่งเป็นสีส้ม และ Agent ตัวนั้นอยู่ในแท็บรอคุณเมื่อ Owner เปิดแท็บนั้น

#### Scenario: Turn ถูกขัดจังหวะ
- **WHEN** Turn ล่าสุดของ Agent จบด้วยเหตุผล `interrupted`
- **THEN** Agent นั้นอยู่ในแท็บรอคุณ ไม่ใช่แท็บเสร็จ

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ของ Agent ออฟไลน์
- **THEN** Agent นั้นอยู่ในแท็บทั้งหมดเท่านั้น และอยู่ท้ายรายการ

#### Scenario: แท็บว่าง
- **WHEN** Owner เปิดแท็บทำงาน และไม่มี Agent ที่กำลังทำงาน
- **THEN** Inbox บอกว่าไม่มี Agent ที่กำลังทำงาน

#### Scenario: เปิดแอปใหม่
- **WHEN** Owner เลือกแท็บเสร็จ แล้วปิดแอปและเปิดใหม่
- **THEN** Inbox เปิดที่แท็บทั้งหมด
