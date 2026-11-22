# controller-character Specification

## Purpose

กำหนดว่า Character ของ Agent บน Controller ได้หน้าตามาจากไหน และ Mood ที่แสดงได้มาจาก event ของ Task กับสถานะของ Machine อย่างไร โดยที่ LLM ไม่ได้เป็นคนเลือก

## Requirements

### Requirement: Agent แต่ละตัวมี Character ที่เหมือนกันทุกเครื่อง
Controller SHALL แสดง Agent ด้วย Character ซึ่งเป็นหัวหุ่นยนต์ลอยที่ไม่มีตัว มีเปลือกหนึ่งแบบ ชิ้นส่วนหนึ่งชิ้นในแต่ละช่องสามช่อง และสีของ Agent หน้าตา SHALL เป็นค่า `character` ที่ Machine เก็บไว้กับ Agent และส่งมาในรายชื่อ Agent ไม่ใช่ค่าที่คิดจากรหัสของ Agent Controller ทุกเครื่องจึง SHALL วาด Agent ตัวเดียวกันเหมือนกันแม้แอปคนละรุ่น และหน้าตา SHALL ไม่เปลี่ยนเมื่ออัปเดตแอป Agent ที่ไม่มี `character` SHALL ได้หน้าตาเริ่มต้นแบบเดียว ช่องที่ Controller ไม่รู้จักค่า SHALL ใช้ตัวเลือกแรกของช่องนั้นโดยช่องอื่นคงเดิม หน้าตา SHALL ไม่เปลี่ยนตาม Mood ยกเว้นตอนออฟไลน์ที่เป็นสีเทา Character SHALL เป็นแค่หน้าตา ไม่มีผลกับคำพูดหรือการทำงานของ Agent และ SHALL ไม่ถูกอ่านโดยโปรแกรมอ่านหน้าจอ เพราะชื่อกับสถานะอยู่ข้างๆ อยู่แล้ว

#### Scenario: เปิดแอปใหม่
- **WHEN** Owner ปิดแอปแล้วเปิดใหม่ หรือเปิดบนเว็บ
- **THEN** Agent แต่ละตัวมี Character หน้าตาเดิม

#### Scenario: Agent ที่มีอยู่ก่อน
- **WHEN** Owner อัปเดตแอปที่มี Agent ซึ่งสร้างไว้ก่อนมี `character`
- **THEN** Agent นั้นมี Character หน้าตาเริ่มต้นโดยไม่ต้องทำอะไรเพิ่ม

#### Scenario: อัปเดตแอป
- **WHEN** Owner อัปเดตแอปเป็นรุ่นที่เพิ่มชิ้นส่วนหรือเปลี่ยนวิธีวาด
- **THEN** Agent ที่มีอยู่มีสี เปลือก และชิ้นส่วนเดิม

### Requirement: เลือก Character ตอนสร้าง Agent
หน้าสร้าง Agent SHALL แสดง Character ที่ Agent ใหม่จะได้ และ SHALL มีปุ่มสุ่ม Character ใหม่ ปุ่มนั้น SHALL สุ่มหน้าตาใหม่โดยไม่เปลี่ยนอะไรอื่น Character ที่สุ่มได้ SHALL ไม่ซ้ำกับ Agent ตัวอื่นที่ Controller รู้จัก Controller SHALL ส่งหน้าตานั้นไปในคำสั่งสร้าง และเมื่อสร้างแล้ว Agent SHALL มี Character ตามที่เห็นในหน้าสร้าง การแก้หน้าตาหลังสร้างอยู่ใน `agent-settings`

#### Scenario: สุ่มแล้วสร้าง
- **WHEN** Owner กดสุ่ม Character ใหม่สองครั้งแล้วกดสร้าง
- **THEN** Agent ใหม่ใน Inbox มี Character แบบที่เห็นล่าสุดก่อนกดสร้าง

### Requirement: Mood ได้จาก event ล่าสุดและสถานะของ Machine
Mood ของ Character SHALL คำนวณบน Controller จาก event ล่าสุดของ Task ที่ Controller รู้จักชนิด และจากสถานะของ Machine โดย LLM ไม่ได้เลือก ทุกหน้าที่แสดง Mood ของ Task เดียวกัน SHALL ได้ Mood เดียวกัน Mood มีเจ็ดแบบ เรียงตามลำดับที่มาก่อน:

- ออฟไลน์ เมื่อรู้ว่า Machine ไม่ได้ต่อ Hub ซึ่งมาก่อนทุกแบบ
- รอ เมื่อ event ล่าสุดคือ Approval ที่รอคนตอบ Character ยกมือจนกว่าจะมีคนตอบ
- ล้มเหลว เมื่อ Turn ล่าสุดจบด้วย error
- เสร็จ เมื่อ Turn ล่าสุดจบตามปกติ
- ว่าง เมื่อ Task ยังไม่มี event หรือ Turn ล่าสุดจบเพราะมีคนหยุดหรือ Machine เริ่มใหม่กลาง Turn
- ทำงาน เมื่อ Turn ยังไม่จบ และ event ล่าสุดคือคำตอบของ LLM ที่ขอใช้ tool
- คิด เมื่อ Turn ยังไม่จบ และไม่มีคำสั่งที่ Agent ขอใช้ tool ค้างอยู่

Machine ที่ยังไม่รู้สถานะ SHALL ไม่นับว่าออฟไลน์ เมื่อ Mood เปลี่ยนจากพักเป็นทำงาน Character SHALL กระโดดหนึ่งครั้ง และเมื่อเปลี่ยนเป็นเสร็จ SHALL กระโดดและหมุนหนึ่งรอบ Mood ล้มเหลว SHALL ไม่กระโดดหรือฉลอง และ SHALL ต่างจากว่างทั้งที่ตาและสีจอ เมื่อเครื่องตั้งให้ลดการเคลื่อนไหว Character SHALL เปลี่ยนท่าทันทีโดยไม่ขยับต่อเนื่อง

#### Scenario: ส่งข้อความแล้ว Agent ตอบ
- **WHEN** Owner ส่งข้อความ แล้ว Agent ตอบจบ Turn
- **THEN** Character ใน Inbox และในหน้า Task เปลี่ยนเป็นคิด แล้วเป็นเสร็จ

#### Scenario: Agent เรียก tool
- **WHEN** event ล่าสุดของ Turn ที่ยังไม่จบคือคำตอบของ LLM ที่ขอใช้ tool
- **THEN** Character เป็นทำงาน และกลับเป็นคิดเมื่อผลของ tool เข้ามา

#### Scenario: Turn จบด้วย error
- **WHEN** Turn ล่าสุดจบเพราะ Provider ล้มเหลว
- **THEN** Character เป็นล้มเหลว ไม่ใช่ว่าง และไม่กระโดดฉลอง

#### Scenario: มีคนหยุด Turn
- **WHEN** Turn ล่าสุดจบเพราะ Member กดหยุด
- **THEN** Character เป็นว่าง ไม่ใช่ล้มเหลว

#### Scenario: Approval รออยู่
- **WHEN** event ล่าสุดของ Task คือ `approval.requested` ที่ยังไม่มีคนตอบ
- **THEN** Character ยกมือ และกลับเป็น Mood ตาม event ถัดไปเมื่อมีคนตอบ

#### Scenario: Machine ปิด
- **WHEN** Hub บอกว่า Machine ของ Agent ออฟไลน์ ระหว่างที่ Turn ยังไม่จบ
- **THEN** Character เป็นสีเทาและวางนิ่งบนพื้น และกลับเป็น Mood ตาม event เมื่อ Machine กลับมา

#### Scenario: event ชนิดใหม่
- **WHEN** Runtime ที่ใหม่กว่าส่ง event ชนิดที่ Controller ไม่รู้จักเป็น event ล่าสุด
- **THEN** Mood คิดจาก event ล่าสุดที่รู้จัก

### Requirement: ชุดสีที่เลือกได้ไม่เปลี่ยนสีของ Agent ที่มีอยู่
หน้าสร้าง Agent และหน้าแก้ Character SHALL ให้เลือกสีจากชุดแปดสีของ Controller และ SHALL มีเปลือกห้าแบบให้เลือก รวมถึงทรงกลม Agent ที่มีสีซึ่งไม่อยู่ในชุดนี้ SHALL ถูกวาดด้วยสีของตัวเองต่อไป และหน้าแก้ Character SHALL ไม่แสดงว่าสีใดในชุดถูกเลือกไว้ จนกว่า Owner จะเลือกสีใหม่ Agent ที่ไม่มี `character` SHALL ได้สีเริ่มต้นเดิมแม้ชุดสีเปลี่ยน

#### Scenario: Agent ที่สร้างก่อนเปลี่ยนชุดสี
- **WHEN** Owner อัปเดตแอปเป็นรุ่นที่มีชุดสีใหม่ และมี Agent ที่ใช้สีจากชุดเดิม
- **THEN** Agent นั้นยังมีสีเดิมใน Inbox และในหน้าแก้ Character ไม่มีวงสีไหนถูกเลือก

#### Scenario: เลือกทรงกลม
- **WHEN** Owner เลือกเปลือกทรงกลมแล้วกดเสร็จ
- **THEN** Inbox บนทุกเครื่องของ Owner ที่ใช้แอปรุ่นนี้แสดง Agent เป็นทรงกลม และแอปรุ่นที่ไม่รู้จักทรงกลมแสดงเป็นเปลือกแบบแรกโดยชิ้นส่วนอื่นคงเดิม

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
