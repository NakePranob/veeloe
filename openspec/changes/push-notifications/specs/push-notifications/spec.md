# Spec Delta

## Purpose

กำหนดการแจ้งเตือนผ่าน Expo Push Service ให้ Member รู้ว่า Approval รออยู่หรือ Turn ที่ตนเริ่มจบลง โดย Runtime เป็นผู้เลือกผู้รับจาก Grant และเนื้อหาไม่เปิดเผยข้อมูล Task

คำศัพท์: **Push Token** คือ token ของ Expo ที่ผูกกับ Controller หนึ่งเครื่อง; **Token Record** คือ token กับภาษาที่ Runtime เก็บต่อ Member ต่อกุญแจ Controller; **Generic Push** คือข้อความกลางๆ ที่ไม่มีข้อความ Task ชื่อไฟล์ หรือชื่อ Agent

## ADDED Requirements

### Requirement: ลงทะเบียน Push Token
Controller SHALL ส่ง `push.register` ที่เซ็นแล้วไปยัง Machine เมื่อได้ Push Token และทุกครั้งที่เชื่อม Hub ใหม่; Runtime MUST เก็บ Token Record ต่อ Member ต่อกุญแจ Controller และ MUST เขียนทับ record เดิมเมื่อลงทะเบียนซ้ำ

#### Scenario: ลงทะเบียนครั้งแรก
- **WHEN** Controller ได้ Push Token และเชื่อมกับ Machine
- **THEN** Runtime เก็บ token และภาษาไว้ใต้ Member ของกุญแจนั้น

#### Scenario: Token เปลี่ยน
- **WHEN** Controller ส่ง token ใหม่ของกุญแจเดิม
- **THEN** Runtime ใช้ token ใหม่แทน token เดิม

#### Scenario: ปิดการแจ้งเตือน
- **WHEN** Member ปิด notification ของ Controller เครื่องนั้น
- **THEN** Controller ส่ง `push.unregister` และ Runtime ลบ Token Record ของกุญแจนั้น

#### Scenario: ถอนกุญแจ
- **WHEN** กุญแจ Controller ถูกถอน
- **THEN** Runtime ลบ Token Record ของกุญแจนั้นและไม่ส่ง push อีก

### Requirement: เลือกผู้รับจาก Grant
Runtime MUST ส่ง push ของ Approval ไปยัง Member ที่มี Approve ที่ Agent นั้น และ MUST ส่ง push ของ Turn ที่จบไปยัง Member ที่เริ่ม Turn นั้นเท่านั้น; Runtime MUST NOT ส่ง push ของ Task ให้ Member คนอื่น แม้จะเปิดดู Task ได้

#### Scenario: Approval รออยู่
- **WHEN** Agent สร้าง `approval.requested`
- **THEN** Member ที่มี Approve ที่ Agent ได้รับ Generic Push

#### Scenario: Turn จบ
- **WHEN** Turn ที่ Member หนึ่งเริ่มจบลง
- **THEN** Member คนนั้นได้รับ Generic Push และ Member คนอื่นไม่ได้รับ

#### Scenario: Task ของ Channel
- **WHEN** Task มาจาก Channel และไม่มี Approval
- **THEN** ไม่มี push สำหรับ Turn นั้น

### Requirement: เนื้อหา Push ไม่มีข้อมูล Task
Push MUST ใช้ข้อความกลางๆ ตามภาษาใน Token Record; payload MUST NOT มีข้อความ Task ชื่อไฟล์ ชื่อ Agent หรือเนื้อหาไฟล์; `data` MAY มีเฉพาะรหัส `kind`, `agent`, `task` และ `approval`

#### Scenario: Approval Push
- **WHEN** Runtime ส่ง push ของ Approval
- **THEN** body เป็นข้อความกลางๆ และ `data.kind` เป็น `approval`

#### Scenario: Turn จบ Push
- **WHEN** Runtime ส่ง push ของ Turn ที่จบ
- **THEN** body เป็นข้อความกลางๆ และไม่มีข้อความที่ Agent ตอบ

### Requirement: Push ล้มเหลวไม่ทำให้ Task ล้มเหลว
Runtime MUST ถือว่า push เป็น best-effort; error จาก Expo MUST NOT เปลี่ยนผลของ Turn หรือ Approval; Runtime MUST ลบ Token Record เมื่อ Expo ตอบ `DeviceNotRegistered`

#### Scenario: Token ตาย
- **WHEN** Expo ตอบ `DeviceNotRegistered`
- **THEN** Runtime ลบ Token Record และไม่ส่งไป token นั้นอีก

#### Scenario: Expo ล่ม
- **WHEN** เรียก Expo ไม่สำเร็จ
- **THEN** Turn และ Approval ยังทำงานตามปกติ และบันทึก log ที่ไม่มีเนื้อหา Task

### Requirement: Controller จัดการ Push ที่ได้รับ
Controller MUST ไม่แสดง banner ซ้ำเมื่อกำลังเปิด Active Task เดียวกัน และ MUST เปิด Task หรือ Approval ที่ถูกต้องเมื่อกด push; Controller MUST ขออนุญาต notification ก่อนลงทะเบียน token

#### Scenario: กด Push ขณะแอปปิด
- **WHEN** Member กด Generic Push ของ Turn
- **THEN** Controller เปิด Task นั้นหลังปลดล็อก

#### Scenario: กำลังดู Task อยู่
- **WHEN** push ของ Task ที่เปิดอยู่มาถึงขณะแอปอยู่ foreground
- **THEN** Controller ไม่แสดง banner ซ้ำและอัปเดต state ตามปกติ
