# agent-settings Specification

## Purpose

Owner แก้ชื่อ Provider model และ Character ของ Agent หลังสร้างได้ด้วยคำสั่งที่เซ็นไปที่ Machine ที่ Agent อยู่ โดย Task ที่เปิดอยู่ไม่เปลี่ยน model กลางทาง และเครื่องอื่นของ Owner เห็นค่าใหม่

## Requirements

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

### Requirement: Runtime ตรวจ Agent, Provider และ model ก่อนเปลี่ยน
supervisor SHALL ตอบ `agent.unknown` เมื่อไม่มี Agent ตาม `id` SHALL ตอบ `agent.provider_unknown` เมื่อ Provider ที่ขอไม่อยู่บน Machine หรือ model ที่ขอไม่อยู่ในรายชื่อ model ที่ Provider นั้นตอบด้วย key ที่ Machine ถือ และ SHALL ตอบด้วย code ของปัญหาเมื่อถามรายชื่อ model ไม่ได้ เมื่อข้อความเปลี่ยนแค่ `model` supervisor SHALL ตรวจกับ Provider ปัจจุบันของ Agent ถ้าตรวจไม่ผ่าน supervisor SHALL ไม่เปลี่ยน field ใดเลยในข้อความนั้น error SHALL ไปถึงคนที่สั่งพร้อม `ref` ของซอง

#### Scenario: Provider ไม่อยู่บน Machine
- **WHEN** Owner ส่ง `agent.update` ที่ `provider` ไม่ใช่ชื่อ Provider บน Machine
- **THEN** Owner ได้ `agent.provider_unknown` และ Agent ยังใช้ Provider เดิม

#### Scenario: model ไม่อยู่ในรายชื่อ
- **WHEN** Owner ส่ง `agent.update` ที่มีแค่ `model` ซึ่ง Provider ปัจจุบันไม่มี
- **THEN** Owner ได้ `agent.provider_unknown` และ Agent ยังใช้ model เดิม

#### Scenario: ชื่อผ่านแต่ model ไม่ผ่าน
- **WHEN** ข้อความเดียวมี `name` ใหม่และ `model` ที่ไม่อยู่ในรายชื่อ
- **THEN** ชื่อก็ไม่เปลี่ยน

#### Scenario: ไม่มี Agent นี้
- **WHEN** Owner ส่ง `agent.update` ด้วย `id` ที่ Machine ไม่มี
- **THEN** Owner ได้ `agent.unknown`

### Requirement: ทุกเครื่องของ Member เห็นค่าใหม่
เมื่อเปลี่ยนสำเร็จ supervisor SHALL ส่ง `agent.listed` ที่มีรายชื่อ Agent ทั้งหมดถึงทุก Member ใน trust ไม่ใช่แค่คนสั่ง Hub ส่งถึงทุก Controller ของ Member นั้น Controller SHALL ทับค่าเดิมของ Agent ด้วยค่าที่ Machine ส่งมาเท่านั้น และ SHALL ไม่แสดงค่าที่ตัวเองส่งไปว่าเปลี่ยนแล้วก่อนได้ `agent.listed`

#### Scenario: แก้จากมือถือ เว็บเห็น
- **WHEN** Owner เปลี่ยนชื่อ Agent จาก iPhone ขณะที่เว็บที่ Link แล้วเปิดหน้า Agent นั้นอยู่
- **THEN** เว็บแสดงชื่อใหม่โดยไม่ต้องกดอะไร

### Requirement: เปลี่ยน Provider หรือ model มีผลตั้งแต่ Task ถัดไป
supervisor SHALL ตรึง Provider กับ model ให้แต่ละ Task ตั้งแต่คำขอแรกของ Task นั้นไป LLM และ SHALL ใช้ค่าที่ตรึงไว้กับทุกคำขอต่อจากนั้นของ Task เดียวกัน แม้ค่าของ Agent เปลี่ยนไปแล้วหรือ Runtime เริ่มใหม่ Task ที่เริ่มหลังเปลี่ยน SHALL ใช้ค่าใหม่ ยกเว้นเมื่อ Provider ที่ Task ตรึงไว้ไม่อยู่บน Machine แล้ว ซึ่ง supervisor SHALL ตรึง Task นั้นใหม่กับค่าปัจจุบันของ Agent การเปลี่ยนค่า SHALL ไม่ตัด Turn ที่ทำอยู่ และ SHALL ไม่เริ่ม worker ใหม่ (ADR 0042)

#### Scenario: เปลี่ยน model ระหว่าง Turn
- **WHEN** Owner เปลี่ยน model ขณะที่ Agent กำลังทำ Turn ใน Task หนึ่ง
- **THEN** Turn นั้นทำต่อจนจบ และทุกคำขอของ Task นั้นไปที่ model เดิม

#### Scenario: Task ใหม่หลังเปลี่ยน
- **WHEN** Owner เปลี่ยน model แล้วเริ่ม Task ใหม่
- **THEN** คำขอของ Task ใหม่ไปที่ model ใหม่

#### Scenario: Task ที่ Provider ถูกลบ
- **WHEN** Provider ของ Agent ถูกลบด้วย `veeloe provider remove` แล้ว Owner เลือก Provider ตัวอื่น แล้วพิมพ์ต่อใน Task เดิม
- **THEN** Task เดิมคุยต่อได้ด้วย Provider กับ model ใหม่ แทนที่จะจบด้วย `provider.missing`

#### Scenario: เริ่ม Runtime ใหม่หลังเปลี่ยน
- **WHEN** Owner เปลี่ยน model แล้วรัน `veeloe` ใหม่ แล้วพิมพ์ต่อใน Task ที่เริ่มก่อนเปลี่ยน
- **THEN** คำขอของ Task นั้นยังไปที่ model เดิม

### Requirement: ชื่อใหม่ถึง worker โดยไม่เริ่มใหม่
เมื่อชื่อเปลี่ยน supervisor SHALL ส่งชื่อใหม่ให้ worker ของ Agent นั้นโดยไม่หยุด worker และ worker SHALL ใช้ชื่อใหม่ใน system prompt ตั้งแต่ Turn ถัดไปของทุก Task Turn ที่ทำอยู่ SHALL ใช้ชื่อเดิมจนจบ worker ที่เริ่มใหม่ภายหลัง SHALL ได้ชื่อล่าสุดจากไฟล์รายชื่อ

#### Scenario: ถามชื่อหลังเปลี่ยน
- **WHEN** Owner เปลี่ยนชื่อ Agent เป็น Deployer แล้วถาม Agent ว่าชื่ออะไรใน Task ใหม่
- **THEN** Agent ตอบว่าชื่อ Deployer

### Requirement: Character เปลี่ยนตามที่ Controller ส่ง
supervisor SHALL เก็บ `character` ใน `agent.update` ตามที่ส่งมา รวมถึงชิ้นส่วนที่ Machine ไม่รู้จัก และ Controller ที่แก้ Character SHALL ส่งชิ้นส่วนที่ตัวเองไม่รู้จักและ Owner ไม่ได้แตะกลับไปตามเดิม เพื่อให้ชิ้นส่วนที่ Controller รุ่นใหม่กว่าเลือกไว้ไม่หาย (ADR 0023) Character SHALL ไม่มีผลกับ worker หรือ Task

#### Scenario: แก้แค่สี
- **WHEN** Owner เปลี่ยนแค่สีของ Character แล้วกด เสร็จ
- **THEN** Inbox บนทุกเครื่องของ Owner แสดงสีใหม่กับชิ้นส่วนเดิม

#### Scenario: ชิ้นส่วนที่ Controller นี้ไม่รู้จัก
- **WHEN** Agent มี `shell` ที่ Controller นี้ไม่รู้จัก และ Owner แก้แค่สีจาก Controller นี้
- **THEN** `agent.update` ส่ง `shell` เดิมกลับไป

### Requirement: หน้า Agent แก้ชื่อ Provider model และ Character ได้
หน้า Agent ใน Controller SHALL ให้แก้ชื่อแล้วกดบันทึก SHALL มีแถว Character ที่ไปหน้าแก้ Character และ SHALL มีแถว Provider กับ model ที่ไปหน้าเลือกด้วยแถวติ๊ก ซึ่งแสดง Provider กับ model จากรายชื่อที่ Machine ส่งมาเหมือนหน้าสร้าง Agent หน้าเลือก SHALL บอกว่าเปลี่ยนแล้วมีผลตั้งแต่ Task ถัดไป ระหว่างรอ Machine ตอบ SHALL แสดงว่ากำลังบันทึก และเมื่อได้ error SHALL แสดงคำของ code นั้น เมื่อ Machine ออฟไลน์หรือ Hub ไม่ได้ต่ออยู่ ปุ่มบันทึกและปุ่ม เสร็จ SHALL ใช้ไม่ได้และหน้าบอกว่า Machine ต้องออนไลน์ หน้าแก้ Character SHALL แสดงหัวขนาดใหญ่ ตัวอย่างในทุก Mood ที่แอปมี และตัวเลือกสีกับชิ้นส่วนแต่ละช่อง การเลือกเปลี่ยนแค่ร่าง ปุ่ม เสร็จ ส่ง `agent.update` และปุ่มยกเลิกหรือปัดกลับทิ้งร่าง

#### Scenario: เปลี่ยน model
- **WHEN** Owner เปิดหน้า Agent กดแถว Provider และ model ติ๊ก model อื่นแล้วกดบันทึก
- **THEN** หลัง Machine ตอบ หน้า Agent แสดง model ใหม่

#### Scenario: Machine ออฟไลน์
- **WHEN** Owner เปิดหน้า Agent ของ Agent ที่ Machine ออฟไลน์
- **THEN** ช่องชื่อกับหน้าเลือกบันทึกไม่ได้ และบอกว่า Machine ต้องออนไลน์ก่อน

#### Scenario: ยกเลิกการแก้ Character
- **WHEN** Owner เปลี่ยนชิ้นส่วนในหน้าแก้ Character แล้วกดยกเลิก
- **THEN** ไม่มีอะไรถูกส่ง และ Character เท่าเดิม

### Requirement: หน้า Agent บอกเมื่อ Provider หรือ model ไม่อยู่บน Machine แล้ว
เมื่อ Machine ส่งรายชื่อ Provider มาแล้วและไม่มี Provider ของ Agent หน้า Agent SHALL แสดงคำเตือนว่า Provider นั้นไม่อยู่บน Machine แล้ว Agent จึงตอบไม่ได้ พร้อมพาไปหน้าเลือก Provider กับ model เมื่อ Provider ยังอยู่แต่รายชื่อ model ของมันไม่มี model ของ Agent หน้า Agent SHALL เตือนแบบเดียวกันว่า model ไม่อยู่ในรายชื่อแล้ว เมื่อ Provider ตอบรายชื่อไม่ได้ หรือ Controller ยังไม่ได้รายชื่อจาก Machine หน้า Agent SHALL ไม่เตือน หน้าเลือก SHALL ไม่ติ๊กแถวใดเมื่อค่าปัจจุบันไม่อยู่ในรายชื่อ คำของ error `provider.missing` ในหน้า Task SHALL บอกให้เลือก Provider ใหม่ในหน้า Agent และ `veeloe provider remove` SHALL บอกว่า Agent ที่ใช้ Provider นั้นเลือก Provider ใหม่ได้จากหน้า Agent ในแอป

#### Scenario: Provider ถูกลบ
- **WHEN** Owner รัน `veeloe provider remove` กับ Provider ที่ Agent ใช้ แล้วเปิดหน้า Agent
- **THEN** หน้า Agent เตือนว่า Provider ไม่อยู่บน Machine แล้ว และกดไปเลือกตัวใหม่ได้

#### Scenario: Provider ตอบรายชื่อไม่ได้
- **WHEN** Provider ของ Agent ตอบรายชื่อ model เป็น error
- **THEN** หน้า Agent ไม่เตือนว่า model หายไป

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
หน้า Agent SHALL มีส่วน Budget วันนี้ต่อจากแถว Provider และ model ที่มีแถบการใช้ จำนวน token ที่ใช้ไปจาก Budget เป็นตัวย่อเช่น 2.4M กับเปอร์เซ็นต์ และไอคอนเตือนเมื่อใช้ถึง 80% กับคำว่าหมดแล้วเมื่อถึง 100% ส่วนนี้ SHALL ให้ Owner ใส่ Budget เป็นล้าน token ต่อวัน และปุ่มบันทึกที่หัวหน้าของหน้า SHALL ส่ง `agent.update` ที่มี `id`, `name` และ `budget` ในซองเดียวเมื่อ Budget เปลี่ยน หรือส่งเฉพาะ `id` กับ `name` เมื่อ Budget ไม่เปลี่ยน การกดบันทึก SHALL ปิดคีย์บอร์ด และเหมือนการแก้อื่นในหน้านี้ คือแสดงว่ากำลังบันทึกระหว่างรอ แสดงค่าใหม่เมื่อได้ `agent.listed` และแสดงคำของ code เมื่อได้ error ค่าที่ไม่ใช่ตัวเลขที่มากกว่า 0 SHALL ไม่ถูกส่ง และเมื่อ Machine ออฟไลน์หรือมีค่า Budget ที่ไม่ถูกต้อง ปุ่มบันทึก SHALL กดไม่ได้ คำท้ายส่วน SHALL บอกว่านับทุก token ที่ Provider รายงาน วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine และแนะนำให้ตั้ง spend limit ที่ Provider ไว้ด้วย รายชื่อ Agent SHALL แสดงเปอร์เซ็นต์ของ Budget วันนี้ของแต่ละตัว และหน้าสร้าง Agent SHALL บอกว่า Budget เริ่มที่ 10M token ต่อวันและตั้งทีหลังได้ที่หน้า Agent คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ

#### Scenario: ตั้ง Budget
- **WHEN** Owner ใส่ 20 แล้วกดบันทึกที่หัวหน้าขณะ Machine ออนไลน์
- **THEN** หน้า Agent แสดง Budget 20M หลัง Machine ตอบ และเปิดแอปใหม่ก็ยังเป็น 20M

#### Scenario: ใส่ค่าผิด
- **WHEN** Owner ใส่ 0 หรือข้อความที่ไม่ใช่ตัวเลข
- **THEN** ปุ่มบันทึกกดไม่ได้ และไม่มีซองถูกส่ง

#### Scenario: ใกล้หมด
- **WHEN** ยอดของวันนี้อยู่ที่ 85% ของ Budget
- **THEN** หน้า Agent แสดงไอคอนเตือนข้างตัวเลข

### Requirement: agent.update รับ allowlist ทั้งชุด
`agent.update` SHALL รับ field `allowlist` ที่ไม่บังคับ เป็นรายการ string ทั้งชุด supervisor SHALL ตรวจรูปเหมือนตอนสร้าง และ SHALL เขียนทับของเดิมในขั้นเดียวให้อยู่รอดข้ามการเริ่มใหม่ การเปลี่ยน SHALL มีผลกับคำขอถัดไปของ worker โดยไม่ตัด Turn ที่ทำอยู่ และ SHALL ส่ง `agent.listed` ใหม่ถึงทุก Member ใน trust เหมือนการแก้อื่น

#### Scenario: เพิ่มรายการระหว่างรอ
- **WHEN** Owner ส่ง `agent.update` ที่เพิ่ม `npm test` ขณะมีคำขอ Approval ของ `npm test` รออยู่
- **THEN** Allowlist ใหม่มีผลกับคำขอถัดไป และ `agent.listed` ใหม่ถึงทุกเครื่อง

#### Scenario: รูปผิด
- **WHEN** `agent.update` มี `allowlist` ที่ไม่ใช่รายการ string
- **THEN** ซองไม่ผ่านและ Allowlist เดิมไม่เปลี่ยน
