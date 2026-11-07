# controller-tasks Specification

## Purpose

กำหนดว่า Owner สร้าง Agent และคุยกับ Agent ใน Task จาก Controller อย่างไร โดยที่สิ่งที่เคยเห็นยังอยู่แม้ไม่มีสัญญาณ (ADR 0021)

## Requirements

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
Controller SHALL ให้ Owner สร้าง Agent บน Machine ที่ออนไลน์ โดยตั้งชื่อ และเลือก Provider กับ model จากรายชื่อที่ Machine ตอบ เมื่อ Machine ยังไม่มี Provider Controller SHALL บอกให้รัน `veeloe provider add` ที่ Machine Agent ใหม่ SHALL ขึ้นใน Inbox บนหน้าแรก หนึ่งแถวต่อ Agent พร้อมชื่อ Machine สถานะ และข้อความล่าสุด

#### Scenario: สร้างสำเร็จ
- **WHEN** Owner ตั้งชื่อ เลือก Provider กับ model แล้วกดสร้าง
- **THEN** Task แรกของ Agent เปิดขึ้น และ Agent มีแถวใน Inbox แม้เปิดแอปใหม่ก็ยังอยู่

#### Scenario: Machine ไม่มี Provider
- **WHEN** Owner เปิดหน้าสร้าง Agent ของ Machine ที่ยังไม่มี Provider
- **THEN** Controller แสดงคำสั่ง `veeloe provider add` แทนตัวเลือก

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ไม่ได้ต่อ Hub
- **THEN** Controller บอกว่า Machine ออฟไลน์ และไม่ให้กดสร้าง

### Requirement: Owner คุยกับ Agent ใน Task
การแตะแถวของ Agent ใน Inbox SHALL เปิด Task ล่าสุดของ Agent นั้น หรือ Task ใหม่ถ้ายังไม่มี หน้า Task SHALL แสดงข้อความของ Owner และข้อความที่ Agent ตอบตามลำดับของ event ปุ่มที่หัวหน้า Task SHALL เปิดหน้า Agent ซึ่งมีรายชื่อ Task ของ Agent นั้นและปุ่ม Task ใหม่ ระหว่าง Turn Controller SHALL แสดงว่า Agent กำลังทำงาน error ทุกตัวที่ได้ SHALL แสดงเป็นคำในภาษาของ Owner ตาม code (ADR 0065)

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

### Requirement: หน้า Task แสดงคำสั่งที่ Agent รัน
หน้า Task SHALL แสดงทุกคำสั่งที่ Agent ขอรันตามลำดับใน log พร้อมสถานะว่ากำลังรัน ผ่าน ล้มเหลว หรือไม่เสร็จ และผลของคำสั่งเมื่อได้แล้ว คำสั่งที่รันติดกันหลายคำสั่ง SHALL รวมเป็นบรรทัดเดียวที่บอกจำนวนและผล แล้วกดเปิดดูทีละคำสั่งได้ คำสั่งที่ Turn จบไปก่อนได้ผล SHALL แสดงว่าไม่เสร็จ แอป SHALL ใช้ข้อความทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: คำสั่งเดียว
- **WHEN** Agent รัน `ls` หนึ่งคำสั่งแล้วตอบ
- **THEN** หน้า Task แสดง `ls` พร้อมผลและเครื่องหมายว่าผ่าน ก่อนคำตอบของ Agent

#### Scenario: กำลังรัน
- **WHEN** Agent ขอคำสั่งที่ยังไม่จบ
- **THEN** หน้า Task แสดงคำสั่งนั้นพร้อมสถานะกำลังรัน

#### Scenario: หลายคำสั่งติดกัน
- **WHEN** Agent รันสามคำสั่งติดกันโดยมีหนึ่งคำสั่งล้มเหลว
- **THEN** หน้า Task แสดงบรรทัดเดียวว่ารัน 3 คำสั่ง ล้มเหลว 1 และกดแล้วเห็นทั้งสามคำสั่ง

#### Scenario: Turn จบก่อนคำสั่งได้ผล
- **WHEN** worker พังระหว่างคำสั่งรัน
- **THEN** หลัง Turn จบ คำสั่งนั้นแสดงว่าไม่เสร็จ

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

### Requirement: Task บอกว่า Budget หมด
เมื่อ Turn จบด้วย code `budget.exhausted` หน้า Task SHALL แสดงการ์ดในภาษาของ Owner ว่า Budget ของวันนี้หมดแล้ว งานใหม่เริ่มตอน 04:00 ตามเวลาของ Machine หรือเมื่อเพิ่ม Budget และไฟล์ที่แก้ไว้ยังอยู่ พร้อมปุ่มที่เปิดหน้า Agent เพื่อเพิ่ม Budget เมื่อข้อความที่ส่งได้ error `budget.exhausted` ข้อความนั้น SHALL ถูกตั้งเป็นส่งไม่สำเร็จ และใต้ข้อความ SHALL มีคำที่บอกว่า Budget ของวันนี้หมดและเพิ่มได้ที่หน้า Agent การกดส่งข้อความ SHALL ปิดคีย์บอร์ด คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: หมดกลาง Turn
- **WHEN** Turn จบด้วย `budget.exhausted`
- **THEN** Task แสดงคำที่บอกว่า Budget หมดกับปุ่มเพิ่ม Budget และข้อความที่ Agent ตอบไปแล้วยังอยู่

#### Scenario: ส่งข้อความตอน Budget หมด
- **WHEN** Owner ส่งข้อความหา Agent ที่ Budget หมดแล้ว
- **THEN** ข้อความถูกตั้งเป็นส่งไม่สำเร็จ และใต้ข้อความมีคำที่บอกว่า Budget หมด

#### Scenario: เพิ่มแล้วพิมพ์ต่อ
- **WHEN** Owner กดปุ่มเพิ่ม Budget ตั้งค่าที่สูงกว่ายอด แล้วกลับมาส่งข้อความใน Task เดิม
- **THEN** Agent ตอบต่อจากบทสนทนาเดิม

### Requirement: หน้า Task แสดงการ์ด Approval และตอบได้ตามสิทธิ์
หน้า Task SHALL แสดง `approval.requested` เป็นการ์ดพร้อมคำสั่งที่ขอ ชื่อ Member ที่ต้องตอบไม่ได้เพราะคำขอไปถึงทุกคนที่มี Approve และการ์ด SHALL แสดงสถานะว่ารออยู่ อนุมัติแล้ว ปฏิเสธแล้ว หรือหมดเวลา ตาม `approval.answered` หรือเวลาหมดอายุ การ์ด SHALL มีปุ่มอนุมัติ ปฏิเสธ และบอกให้ทำอย่างอื่นพร้อมช่องพิมพ์ error ที่ได้ SHALL แสดงเป็นคำในภาษาของ Owner ตาม code (ADR 0065)

#### Scenario: คำขอรออยู่
- **WHEN** log มี `approval.requested` ที่ยังไม่มีคำตอบ
- **THEN** หน้า Task แสดงการ์ดว่ารออยู่พร้อมสามปุ่ม

#### Scenario: หมดเวลาแล้ว
- **WHEN** คำขอเลยเวลาหมดอายุแล้วยังไม่มีคำตอบ
- **THEN** การ์ดแสดงว่าหมดเวลาและปุ่มกดไม่ได้

### Requirement: หน้าสร้าง Agent ติ๊กชุดอ่านอย่างเดียวได้
หน้าสร้าง Agent SHALL มีช่องติ๊กชุดคำสั่งอ่านอย่างเดียวเก้ารายการ (`ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `git status`, `git diff`, `git log`) ที่ติ๊กไว้ตั้งแต่ต้น Member SHALL เอาออกได้ทีละตัวก่อนกดสร้าง คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: เอาออกก่อนสร้าง
- **WHEN** Owner เอาติ๊ก `cat` ออกแล้วกดสร้าง
- **THEN** `agent.create` ที่ส่งไปไม่มี `cat` ใน `allowlist`

### Requirement: หน้า Allowlist ของ Agent แก้ได้ทั้งชุด
หน้า Agent SHALL มีหน้าตั้งค่า Allowlist ที่แสดงรายการปัจจุบัน เพิ่มรายการใหม่ และลบรายการเดิมได้ การบันทึก SHALL ส่ง `agent.update` ที่มี `allowlist` ทั้งชุด ระหว่างรอ Machine ตอบ SHALL แสดงว่ากำลังบันทึก เมื่อ Machine ออฟไลน์ปุ่มบันทึก SHALL ใช้ไม่ได้และหน้าบอกว่า Machine ต้องออนไลน์

#### Scenario: เพิ่มรายการ
- **WHEN** Owner พิมพ์ `npm test` กดเพิ่ม แล้วกดบันทึกขณะ Machine ออนไลน์
- **THEN** หลัง Machine ตอบ หน้า Allowlist แสดง `npm test` ในรายการ
