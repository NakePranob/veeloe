## Purpose

กำหนดว่า Owner สร้าง Agent และคุยกับ Agent ใน Task จาก Controller อย่างไร โดยที่สิ่งที่เคยเห็นยังอยู่แม้ไม่มีสัญญาณ (ADR 0021)

## ADDED Requirements

### Requirement: Controller ต่อ Hub ค้างไว้ระหว่างปลดล็อก
Controller SHALL ต่อ Hub ของทุก Machine ที่ Pairing แล้วขณะที่กุญแจปลดล็อกอยู่ และ SHALL ต่อใหม่เองเมื่อหลุด Controller SHALL รับเฉพาะซองที่เซ็นด้วยกุญแจของ Machine ที่ Pairing ไว้ และ SHALL เขียนสิ่งที่ได้ลงฐานข้อมูลบนเครื่องก่อนแสดง เมื่อต่อได้ Controller SHALL ขอรายชื่อ Agent และขอ event ของทุก Task ที่มีหลังเลขล่าสุดที่เก็บไว้

#### Scenario: เปิดแอปขณะออฟไลน์
- **WHEN** Owner เปิดแอปตอนไม่มีสัญญาณ
- **THEN** เห็น Agent, Task และข้อความที่เคยได้ และส่งข้อความใหม่ไม่ได้จนกว่าจะต่อได้

#### Scenario: ซองจากกุญแจอื่น
- **WHEN** Hub ส่งซองที่ไม่ได้เซ็นด้วยกุญแจของ Machine ที่ Pairing ไว้
- **THEN** Controller ไม่เขียนอะไรลงฐานข้อมูล

#### Scenario: ล็อก
- **WHEN** แอปล็อกเพราะไม่ได้ใช้เกิน 5 นาที
- **THEN** Controller ปิดการเชื่อมต่อ และต่อใหม่หลังปลดล็อก

### Requirement: Owner สร้าง Agent บน Machine
Controller SHALL ให้ Owner สร้าง Agent บน Machine ที่ออนไลน์ โดยตั้งชื่อ และเลือก Provider กับ model จากรายชื่อที่ Machine ตอบ เมื่อ Machine ยังไม่มี Provider Controller SHALL บอกให้รัน `veeloe provider add` ที่ Machine Agent ใหม่ SHALL ขึ้นบนหน้าแรกใต้ Machine ของมัน

#### Scenario: สร้างสำเร็จ
- **WHEN** Owner ตั้งชื่อ เลือก Provider กับ model แล้วกดสร้าง
- **THEN** Agent ขึ้นใต้ Machine นั้น แม้เปิดแอปใหม่ก็ยังอยู่

#### Scenario: Machine ไม่มี Provider
- **WHEN** Owner เปิดหน้าสร้าง Agent ของ Machine ที่ยังไม่มี Provider
- **THEN** Controller แสดงคำสั่ง `veeloe provider add` แทนตัวเลือก

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ไม่ได้ต่อ Hub
- **THEN** Controller บอกว่า Machine ออฟไลน์ และไม่ให้กดสร้าง

### Requirement: Owner คุยกับ Agent ใน Task
การแตะ Agent SHALL เปิด Task ล่าสุดของ Agent นั้น หรือ Task ใหม่ถ้ายังไม่มี หน้า Task SHALL แสดงข้อความของ Owner และข้อความที่ Agent ตอบตามลำดับของ event ปุ่มที่หัวหน้า Task SHALL เปิดหน้า Agent ซึ่งมีรายชื่อ Task ของ Agent นั้นและปุ่ม Task ใหม่ ระหว่าง Turn Controller SHALL แสดงว่า Agent กำลังทำงาน error ทุกตัวที่ได้ SHALL แสดงเป็นคำในภาษาของ Owner ตาม code (ADR 0065)

#### Scenario: ส่งข้อความ
- **WHEN** Owner พิมพ์แล้วกดส่ง
- **THEN** ข้อความขึ้นทันทีว่ากำลังส่ง แล้วคำตอบของ Agent ขึ้นต่อท้ายเมื่อ LLM ตอบเสร็จแต่ละครั้ง

#### Scenario: Agent ไม่ว่าง
- **WHEN** Owner ส่งข้อความระหว่าง Turn ก่อนหน้า
- **THEN** Controller แสดงว่า Agent ยังทำงานอยู่ และข้อความไม่ถูกบันทึกว่าส่งแล้ว

#### Scenario: Turn จบด้วย error
- **WHEN** Turn จบเพราะ Provider ล้มเหลว
- **THEN** Task แสดงคำที่บอกว่าเป็นที่ Provider ในภาษาของ Owner และพิมพ์ต่อได้

#### Scenario: Task ใหม่
- **WHEN** Owner กด Task ใหม่ในหน้า Agent
- **THEN** หน้า Task ว่างเปิดขึ้น และข้อความแรกเริ่ม Task ใหม่บน Machine
