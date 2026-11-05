# machine-pairing Specification

## Purpose

กำหนดว่า Owner ผูก Machine เข้ากับ Workspace อย่างไร โดยที่ Hub ไม่สามารถสลับกุญแจของ Owner หรือของ Machine ระหว่างทางได้ แม้ Hub จะโดนเจาะ

## Requirements

### Requirement: Machine เริ่ม Pairing ที่หน้าเครื่อง
`veeloe pair` SHALL แสดงลิงก์ Pairing เป็น QR และเป็นข้อความใน terminal ลิงก์ SHALL มี URL ของ Hub, กุญแจสาธารณะของ Machine, รหัสลับสุ่มใหม่อย่างน้อย 256 bit, เวลาหมดอายุ 10 นาที และลายเซ็นของ Machine รหัสลับ MUST NOT ถูกส่งออกจาก Machine ทางอื่นนอกจากลิงก์นี้

#### Scenario: เครื่องที่ยังไม่ได้ Pairing
- **WHEN** เจ้าของรัน `veeloe pair --hub <url>` บนเครื่องที่ยังไม่ได้ Pairing
- **THEN** terminal แสดง QR กับลิงก์ และรอจนกว่า Pairing จะเสร็จหรือหมดอายุ

#### Scenario: เครื่องที่ Pairing แล้ว
- **WHEN** เจ้าของรัน `veeloe pair` บนเครื่องที่ Pairing แล้ว
- **THEN** คำสั่งปฏิเสธและบอกให้รัน `veeloe unpair` ก่อน โดยกุญแจที่ไว้ใจอยู่ไม่เปลี่ยน

#### Scenario: หมดเวลา
- **WHEN** ครบ 10 นาทีแล้วยังไม่มีใครทำ Pairing สำเร็จ
- **THEN** คำสั่งจบพร้อมบอกว่าหมดอายุ และ Machine ไม่เชื่อกุญแจใดเพิ่ม

### Requirement: Controller ตรวจลิงก์และถามเจ้าของก่อนผูก
Controller SHALL รับลิงก์จากการสแกนหรือการวาง SHALL ปฏิเสธลิงก์ที่รูปแบบผิด ลายเซ็นผิด หรือหมดอายุ และ SHALL แสดง Hub ที่จะใช้ก่อนให้เจ้าของยืนยัน การยืนยันนั้น MUST ยืนยันตัวใหม่ตาม ADR 0012 แม้แอปปลดล็อกอยู่

#### Scenario: ลิงก์ถูกต้อง
- **WHEN** เจ้าของสแกนหรือวางลิงก์ที่ยังไม่หมดอายุ
- **THEN** แอปแสดง Hub ปลายทาง และรอให้เจ้าของยืนยัน

#### Scenario: ลิงก์ถูกแก้
- **WHEN** ค่าใดในลิงก์ไม่ตรงกับลายเซ็นของ Machine
- **THEN** แอปปฏิเสธลิงก์และไม่ติดต่อ Hub

#### Scenario: ยกเลิกการยืนยันตัว
- **WHEN** เจ้าของยกเลิกการยืนยันตัวตอนยืนยัน Pairing
- **THEN** ไม่มีอะไรถูกส่งออกจากแอป และแอปไม่ล็อกเพราะเรื่องนี้

### Requirement: Hub ลงทะเบียนเมื่อทั้งสองฝั่งเซ็นเท่านั้น
Hub SHALL ลงทะเบียน Machine เฉพาะเมื่อคำขอมีลายเซ็นของ Controller และลายเซ็นของ Machine ที่ถูกต้องและยังไม่หมดอายุ ถ้า Hub ไม่รู้จักกุญแจของ Controller SHALL สร้าง Workspace ใหม่กับ Member ที่เป็น Owner ถ้ารู้จักแล้ว SHALL ใช้ Workspace เดิม การเขียนทั้งหมด SHALL สำเร็จหรือไม่เกิดขึ้นพร้อมกัน error SHALL เป็น code ตาม ADR 0065

#### Scenario: Controller ตัวแรก
- **WHEN** Controller ที่ Hub ไม่รู้จักส่งคำขอที่ลายเซ็นครบ
- **THEN** Hub สร้าง Workspace กับ Member ลงทะเบียนทั้งสองกุญแจ และตอบรหัสของ Workspace, Member กับ Machine

#### Scenario: Machine เครื่องที่สอง
- **WHEN** Controller ที่ Hub รู้จักแล้วส่งคำขอสำหรับ Machine ใหม่
- **THEN** Machine นั้นอยู่ใน Workspace เดิมของ Controller และไม่มี Workspace ใหม่

#### Scenario: Machine ไม่ได้ยินยอม
- **WHEN** ลายเซ็นของ Machine ผิดหรือหมดอายุ
- **THEN** Hub ตอบ `hub.pairing_invalid` และไม่มีอะไรถูกเขียน

#### Scenario: Controller ไม่ได้ถือกุญแจ
- **WHEN** ลายเซ็นของ Controller ผิด
- **THEN** Hub ตอบ `hub.pairing_invalid` และไม่มีอะไรถูกเขียน

#### Scenario: Machine อยู่ใน Workspace อื่นแล้ว
- **WHEN** กุญแจของ Machine ลงทะเบียนไว้ใน Workspace อื่น
- **THEN** Hub ตอบ `hub.machine_taken` และไม่มีอะไรเปลี่ยน รวมถึงไม่มี Workspace ใหม่ค้าง

#### Scenario: ส่งคำขอเดิมซ้ำ
- **WHEN** คำขอเดิมถูกส่งอีกครั้งจาก Workspace เดิม
- **THEN** Hub ตอบผลเดิมโดยไม่สร้างแถวใหม่

### Requirement: Machine เชื่อเฉพาะกุญแจที่พิสูจน์รหัสลับได้
Controller SHALL ส่ง `pairing.claim` ที่เซ็นด้วยกุญแจของตัวเอง โดยมีค่าพิสูจน์ที่คำนวณจากรหัสลับ กุญแจของ Machine, กุญแจของ Controller และรหัส Member Machine SHALL เชื่อกุญแจนั้นเป็น Owner เฉพาะเมื่อลายเซ็นและค่าพิสูจน์ถูกต้อง รายชื่อ Owner SHALL เก็บเป็นรายการ และรหัสลับ SHALL ถูกทิ้งเมื่อ Pairing จบ

#### Scenario: Pairing สำเร็จ
- **WHEN** Machine ได้ `pairing.claim` ที่ถูกต้อง
- **THEN** Machine บันทึกกุญแจนั้นเป็น Owner ตอบ `pairing.done` ที่เซ็นแล้ว และ `veeloe pair` จบพร้อมบอกว่าสำเร็จ

#### Scenario: Hub สลับกุญแจ
- **WHEN** Hub ส่ง `pairing.claim` ที่เซ็นด้วยกุญแจของตัวเอง โดยใช้ค่าพิสูจน์ที่เห็นจากซองจริง
- **THEN** Machine ปฏิเสธ เพราะค่าพิสูจน์ผูกกับกุญแจของ Controller ตัวจริง

#### Scenario: ไม่รู้รหัสลับ
- **WHEN** `pairing.claim` มีค่าพิสูจน์ผิด
- **THEN** Machine ไม่บันทึกอะไร และยังรอ claim ที่ถูกต้องต่อจนหมดเวลา

#### Scenario: ข้อความชนิดอื่นระหว่างรอ
- **WHEN** ระหว่าง Pairing Machine ได้ซองชนิดอื่น
- **THEN** Machine ไม่ทำตาม เพราะยังไม่เชื่อกุญแจใด

### Requirement: Controller เชื่อเฉพาะ Machine จากลิงก์
Controller SHALL ถือว่า Pairing สำเร็จเมื่อได้ `pairing.done` ที่เซ็นด้วยกุญแจของ Machine ในลิงก์เท่านั้น แล้ว SHALL บันทึก Machine ลงฐานข้อมูลบนเครื่องและแสดงบนหน้าแรก เมื่อ Machine ยังออฟไลน์ Controller SHALL ลองส่ง claim ใหม่จนลิงก์หมดอายุ

#### Scenario: สำเร็จ
- **WHEN** ได้ `pairing.done` ที่ลายเซ็นตรงกับกุญแจในลิงก์
- **THEN** หน้าแรกแสดงชื่อ Machine ที่ได้รับ แม้เปิดแอปใหม่ก็ยังอยู่

#### Scenario: ลายเซ็นจากกุญแจอื่น
- **WHEN** `pairing.done` เซ็นด้วยกุญแจอื่น
- **THEN** Controller ไม่บันทึก Machine และยังรอต่อจนหมดเวลา

#### Scenario: Machine ยังไม่ต่อเข้ามา
- **WHEN** Hub ตอบ `hub.machine_offline`
- **THEN** Controller ลองใหม่เอง และแสดง error ที่แปลแล้วเมื่อหมดเวลาโดยที่ยังไม่สำเร็จ

### Requirement: เริ่มเครื่องใหม่จากศูนย์ได้
`veeloe unpair` SHALL ถามยืนยันแล้วลบกุญแจที่ไว้ใจกับกุญแจของ Machine ทำให้ Machine ต้องทำ Pairing ใหม่ด้วยกุญแจใหม่ ใช้ได้โดยไม่ต้องมี Controller

#### Scenario: Controller หายหมด
- **WHEN** เจ้าของรัน `veeloe unpair` และยืนยัน
- **THEN** Machine เลิกเชื่อกุญแจเดิมทั้งหมด และ `veeloe pair` ทำงานได้อีกครั้ง

#### Scenario: เปลี่ยนใจ
- **WHEN** เจ้าของไม่ยืนยัน
- **THEN** ไม่มีอะไรถูกลบ
