## MODIFIED Requirements

### Requirement: Owner แก้ Agent ด้วย `agent.update` ที่เซ็นแล้ว
Protocol SHALL มีข้อความ `agent.update` จาก Controller ถึง Machine ที่มี `id` ของ Agent และ field ที่จะเปลี่ยนอย่างน้อยหนึ่งตัวจาก `name`, `provider`, `model`, `character` และ `budget` โดยแต่ละ field ใช้รูปแบบเดียวกับใน `agent.create` และ `budget` เป็นจำนวนเต็ม token ต่อวันตั้งแต่ 1 ถึง 1,000,000,000,000 ข้อความที่มี `provider` SHALL มี `model` ด้วย เพราะ model เป็นของ Provider ตัวนั้น ข้อความที่ไม่มี field ให้เปลี่ยน มี `provider` โดยไม่มี `model` หรือมี `budget` ที่ไม่ใช่จำนวนเต็มในช่วงนั้น SHALL ไม่ผ่านที่ขอบของข้อความ supervisor SHALL ทำตามเฉพาะซองที่ลายเซ็นผ่านจากกุญแจที่อยู่ใน trust และ Member ของกุญแจนั้น SHALL มี Manage ที่ Agent นั้น ซึ่งใน v0.1 คือ Owner ทุกคนใน trust supervisor SHALL เขียนค่าใหม่ลงไฟล์รายชื่อ Agent ในขั้นเดียวให้อยู่รอดข้ามการเริ่มใหม่ และ SHALL ไม่แตะ field ที่ข้อความไม่ได้ส่งมา

#### Scenario: เปลี่ยนชื่อ
- **WHEN** Owner ส่ง `agent.update` ที่มี `id` กับ `name` ใหม่
- **THEN** รายชื่อ Agent ที่ตอบกลับมีชื่อใหม่ และ Provider model กับ Character เท่าเดิม

#### Scenario: เริ่ม Runtime ใหม่หลังแก้
- **WHEN** Owner แก้ model แล้วรัน `veeloe` ใหม่ แล้ว Controller ขอรายชื่อ
- **THEN** Agent มี model ใหม่

#### Scenario: ไม่มี field ให้เปลี่ยน
- **WHEN** ซอง `agent.update` มีแค่ `id`
- **THEN** supervisor ไม่เปลี่ยนอะไร

#### Scenario: Provider โดยไม่มี model
- **WHEN** ซอง `agent.update` มี `provider` แต่ไม่มี `model`
- **THEN** supervisor ไม่เปลี่ยนอะไร

#### Scenario: Budget ไม่ถูกต้อง
- **WHEN** `budget` เป็น 0, ติดลบ, มีทศนิยม หรือเกินเพดาน
- **THEN** ซองไม่ผ่าน schema และ Budget เดิมไม่เปลี่ยน

#### Scenario: ลายเซ็นไม่ผ่าน
- **WHEN** ซอง `agent.update` เซ็นด้วยกุญแจที่ไม่อยู่ใน trust หรือถูกถอนแล้ว
- **THEN** supervisor ทิ้งซองนั้นและไม่เปลี่ยนอะไร

## ADDED Requirements

### Requirement: Budget ใหม่มีผลกับคำขอถัดไป
Budget ต่างจาก Provider และ model ตรงที่ SHALL มีผลกับคำขอ LLM ถัดไปของทุก Task ของ Agent ทันที ไม่รอ Task ถัดไป เพราะ Budget เป็นของ Agent ไม่ใช่ของ Task (ADR 0043) ข้อความที่เปลี่ยนแค่ `budget` SHALL ไม่ถามรายชื่อ model จาก Provider เมื่อ Budget ใหม่สูงกว่ายอดของวันนี้ Agent SHALL รับงานใหม่ได้ทันทีโดยไม่ต้องรอวันใหม่

#### Scenario: เพิ่ม Budget ตอนหมด
- **WHEN** Budget หมดแล้ว Owner ตั้ง Budget ใหม่ที่สูงกว่ายอดของวันนี้ แล้วส่งข้อความ
- **THEN** Turn เริ่มและคุยกับ Provider ได้

#### Scenario: ลด Budget ต่ำกว่ายอด
- **WHEN** Owner ตั้ง Budget ต่ำกว่ายอดที่ใช้ไปแล้ววันนี้ระหว่าง Turn
- **THEN** Turn นั้นจบด้วย `budget.exhausted` หลังคำตอบที่กำลังมา

#### Scenario: Provider ล่มตอนตั้ง Budget
- **WHEN** Provider ของ Agent ตอบรายชื่อ model ไม่ได้ และ Owner ส่ง `agent.update` ที่มีแค่ `budget`
- **THEN** Budget เปลี่ยน

### Requirement: Controller เก็บ Budget และยอดของวันนี้ไว้บนเครื่อง
Controller SHALL เขียน `budget` กับ `usage` จาก `agent.listed` และ `agent.usage` ลงฐานข้อมูลบนเครื่องก่อนแสดง (ADR 0021) และ SHALL ไม่แทนยอดด้วยค่าที่เก่ากว่า คือยอดของ `day` ที่ก่อนหน้า หรือยอดที่น้อยกว่าใน `day` เดียวกัน `agent.listed` ที่ไม่มีสอง field นี้ SHALL ไม่ลบค่าที่เก็บไว้ Agent ที่ Machine ยังไม่เคยบอก Budget SHALL ไม่แสดงตัวเลข

#### Scenario: ยอดมาไม่เรียงลำดับ
- **WHEN** Controller ได้ `agent.usage` ที่มี 3M แล้วได้ `agent.listed` เก่าที่มี 2M ของวันเดียวกัน
- **THEN** แอปยังแสดง 3M

#### Scenario: เปิดแอปตอนออฟไลน์
- **WHEN** Owner เปิดแอปตอนไม่มีสัญญาณ
- **THEN** หน้า Agent แสดงยอดและ Budget ล่าสุดที่เคยได้

### Requirement: Owner เห็นและตั้ง Budget บนหน้า Agent
หน้า Agent SHALL มีส่วน Budget วันนี้ต่อจากแถว Provider และ model ที่มีแถบการใช้ จำนวน token ที่ใช้ไปจาก Budget เป็นตัวย่อเช่น 2.4M กับเปอร์เซ็นต์ และไอคอนเตือนเมื่อใช้ถึง 80% กับคำว่าหมดแล้วเมื่อถึง 100% ส่วนนี้ SHALL ให้ Owner ใส่ Budget เป็นล้าน token ต่อวันแล้วกดตั้ง ซึ่งส่ง `agent.update` ที่มี `id` กับ `budget` และเหมือนการแก้อื่นในหน้านี้ คือแสดงว่ากำลังบันทึกระหว่างรอ แสดงค่าใหม่เมื่อได้ `agent.listed` และแสดงคำของ code เมื่อได้ error ค่าที่ไม่ใช่ตัวเลขที่มากกว่า 0 หรือเท่าค่าเดิม SHALL ไม่ถูกส่ง และเมื่อ Machine ออฟไลน์ ปุ่มตั้ง SHALL กดไม่ได้ คำท้ายส่วน SHALL บอกว่านับทุก token ที่ Provider รายงาน วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine และแนะนำให้ตั้ง spend limit ที่ Provider ไว้ด้วย รายชื่อ Agent SHALL แสดงเปอร์เซ็นต์ของ Budget วันนี้ของแต่ละตัว และหน้าสร้าง Agent SHALL บอกว่า Budget เริ่มที่ 10M token ต่อวันและตั้งทีหลังได้ที่หน้า Agent คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ

#### Scenario: ตั้ง Budget
- **WHEN** Owner ใส่ 20 แล้วกดตั้ง Budget ขณะ Machine ออนไลน์
- **THEN** หน้า Agent แสดง Budget 20M หลัง Machine ตอบ และเปิดแอปใหม่ก็ยังเป็น 20M

#### Scenario: ใส่ค่าผิด
- **WHEN** Owner ใส่ 0 หรือข้อความที่ไม่ใช่ตัวเลข
- **THEN** ปุ่มตั้ง Budget กดไม่ได้ และไม่มีซองถูกส่ง

#### Scenario: ใกล้หมด
- **WHEN** ยอดของวันนี้อยู่ที่ 85% ของ Budget
- **THEN** หน้า Agent แสดงไอคอนเตือนข้างตัวเลข
