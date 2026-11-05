## Purpose

กำหนดว่า Character ของ Agent บน Controller ได้หน้าตามาจากไหน และ Mood ที่แสดงได้มาจาก event ของ Task กับสถานะของ Machine อย่างไร โดยที่ LLM ไม่ได้เป็นคนเลือก

## ADDED Requirements

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
หน้าสร้าง Agent SHALL แสดง Character ที่ Agent ใหม่จะได้ และ SHALL มีปุ่มสุ่ม Character ใหม่ ปุ่มนั้น SHALL สุ่มหน้าตาใหม่โดยไม่เปลี่ยนอะไรอื่น Character ที่สุ่มได้ SHALL ไม่ซ้ำกับ Agent ตัวอื่นที่ Controller รู้จัก Controller SHALL ส่งหน้าตานั้นไปในคำสั่งสร้าง และเมื่อสร้างแล้ว Agent SHALL มี Character ตามที่เห็นในหน้าสร้าง หลังสร้างแล้วแก้หน้าตาไม่ได้ใน change นี้

#### Scenario: สุ่มแล้วสร้าง
- **WHEN** Owner กดสุ่ม Character ใหม่สองครั้งแล้วกดสร้าง
- **THEN** Agent ใหม่ใน Inbox มี Character แบบที่เห็นล่าสุดก่อนกดสร้าง

### Requirement: Mood ได้จาก event ล่าสุดและสถานะของ Machine
Mood ของ Character SHALL คำนวณบน Controller จาก event ล่าสุดของ Task ที่ Controller รู้จักชนิด และจากสถานะของ Machine โดย LLM ไม่ได้เลือก ทุกหน้าที่แสดง Mood ของ Task เดียวกัน SHALL ได้ Mood เดียวกัน Mood มีห้าแบบ:

- ออฟไลน์ เมื่อรู้ว่า Machine ไม่ได้ต่อ Hub ซึ่งมาก่อนทุกแบบ
- ว่าง เมื่อ Task ยังไม่มี event หรือ Turn ล่าสุดจบด้วย error
- คิด เมื่อ Turn ยังไม่จบ และไม่มีคำสั่งที่ Agent ขอใช้ tool ค้างอยู่
- ทำงาน เมื่อ Turn ยังไม่จบ และ event ล่าสุดคือคำตอบของ LLM ที่ขอใช้ tool
- เสร็จ เมื่อ Turn ล่าสุดจบตามปกติ

Machine ที่ยังไม่รู้สถานะ SHALL ไม่นับว่าออฟไลน์ เมื่อ Mood เปลี่ยนจากพักเป็นทำงาน Character SHALL กระโดดหนึ่งครั้ง และเมื่อเปลี่ยนเป็นเสร็จ SHALL กระโดดและหมุนหนึ่งรอบ เมื่อเครื่องตั้งให้ลดการเคลื่อนไหว Character SHALL เปลี่ยนท่าทันทีโดยไม่ขยับต่อเนื่อง

#### Scenario: ส่งข้อความแล้ว Agent ตอบ
- **WHEN** Owner ส่งข้อความ แล้ว Agent ตอบจบ Turn
- **THEN** Character ใน Inbox และในหน้า Task เปลี่ยนเป็นคิด แล้วเป็นเสร็จ

#### Scenario: Agent เรียก tool
- **WHEN** event ล่าสุดของ Turn ที่ยังไม่จบคือคำตอบของ LLM ที่ขอใช้ tool
- **THEN** Character เป็นทำงาน และกลับเป็นคิดเมื่อผลของ tool เข้ามา

#### Scenario: Turn จบด้วย error
- **WHEN** Turn ล่าสุดจบเพราะ Provider ล้มเหลว
- **THEN** Character เป็นว่าง ไม่กระโดดฉลอง

#### Scenario: Machine ปิด
- **WHEN** Hub บอกว่า Machine ของ Agent ออฟไลน์ ระหว่างที่ Turn ยังไม่จบ
- **THEN** Character เป็นสีเทาและวางนิ่งบนพื้น และกลับเป็น Mood ตาม event เมื่อ Machine กลับมา

#### Scenario: event ชนิดใหม่
- **WHEN** Runtime ที่ใหม่กว่าส่ง event ชนิดที่ Controller ไม่รู้จักเป็น event ล่าสุด
- **THEN** Mood คิดจาก event ล่าสุดที่รู้จัก
