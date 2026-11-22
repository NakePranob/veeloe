## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: ชุดสีที่เลือกได้ไม่เปลี่ยนสีของ Agent ที่มีอยู่
หน้าสร้าง Agent และหน้าแก้ Character SHALL ให้เลือกสีจากชุดแปดสีของ Controller และ SHALL มีเปลือกห้าแบบให้เลือก รวมถึงทรงกลม Agent ที่มีสีซึ่งไม่อยู่ในชุดนี้ SHALL ถูกวาดด้วยสีของตัวเองต่อไป และหน้าแก้ Character SHALL ไม่แสดงว่าสีใดในชุดถูกเลือกไว้ จนกว่า Owner จะเลือกสีใหม่ Agent ที่ไม่มี `character` SHALL ได้สีเริ่มต้นเดิมแม้ชุดสีเปลี่ยน

#### Scenario: Agent ที่สร้างก่อนเปลี่ยนชุดสี
- **WHEN** Owner อัปเดตแอปเป็นรุ่นที่มีชุดสีใหม่ และมี Agent ที่ใช้สีจากชุดเดิม
- **THEN** Agent นั้นยังมีสีเดิมใน Inbox และในหน้าแก้ Character ไม่มีวงสีไหนถูกเลือก

#### Scenario: เลือกทรงกลม
- **WHEN** Owner เลือกเปลือกทรงกลมแล้วกดเสร็จ
- **THEN** Inbox บนทุกเครื่องของ Owner ที่ใช้แอปรุ่นนี้แสดง Agent เป็นทรงกลม และแอปรุ่นที่ไม่รู้จักทรงกลมแสดงเป็นเปลือกแบบแรกโดยชิ้นส่วนอื่นคงเดิม
