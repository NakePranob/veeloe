# direct-link Specification

## Purpose

Controller กับ Machine ต่อตรงกันด้วย WebRTC DataChannel เมื่อทำได้ (ADR 0090) โดยซองที่วิ่งบนทางตรงเป็นซองที่เซ็นแบบเดียวกับที่ผ่าน Hub และถูกตรวจแบบเดียวกัน Hub เป็นที่นัดเจอและทางสำรอง

## Requirements

### Requirement: นัดเจอด้วยซองที่เซ็น
Controller SHALL ขอต่อตรงด้วย `direct.offer` ที่มี SDP ของตัวเอง ซึ่งมี fingerprint ของ DTLS อยู่ใต้ลายเซ็น Machine SHALL ตอบด้วย `direct.answer` ที่มี `id` ของ offer นั้นผ่าน Hub และ SHALL ตอบเฉพาะ offer ที่ตรวจลายเซ็นผ่านจากกุญแจที่เชื่อถือ Controller SHALL รับเฉพาะคำตอบที่ `id` ตรงกับ offer ของตัวเอง

#### Scenario: Controller เปิดแอปขณะ Machine ออนไลน์
- **WHEN** Machine ตอบ `agent.listed` และแอปอยู่หน้าจอ
- **THEN** Controller ส่ง `direct.offer` และเปิดทางตรงเมื่อได้ `direct.answer`

#### Scenario: คำตอบของ offer อื่น
- **WHEN** `direct.answer` มี `id` ที่ไม่ใช่ของ offer ที่รออยู่
- **THEN** Controller ไม่ใช้คำตอบนั้น

### Requirement: ซองบนทางตรงถูกตรวจเหมือนผ่าน Hub
ซองที่มาทางตรง SHALL ผ่านการตรวจลายเซ็น, ปลายทาง, เลขลำดับ และ Grant ชุดเดียวกับซองที่มาจาก Hub ช่องทางที่เข้ารหัส SHALL NOT ถือเป็นการยืนยันตัว (ADR 0006)

#### Scenario: คำสั่งมาทางตรง
- **WHEN** Controller ส่ง `agent.list` บนทางตรงที่เปิดอยู่
- **THEN** Machine ตอบ `agent.listed` บนทางตรง และ Hub ไม่ได้รับซองนั้น

### Requirement: Hub เป็นทางสำรอง
Machine SHALL ส่งซองถึง Member ผ่าน Hub ด้วยเมื่อเครื่องใดของ Member นั้นไม่มีทางตรง ซองที่ใหญ่เกิน 64 KB SHALL วิ่งผ่าน Hub เครื่องที่ได้ซองทั้งสองทาง SHALL รับครั้งเดียว (`protocol-envelope`)

#### Scenario: ทุกเครื่องต่อตรง
- **WHEN** ทุกเครื่องของ Member มีทางตรงเปิดอยู่
- **THEN** Machine ไม่ส่งซองถึง Member นั้นผ่าน Hub

#### Scenario: บางเครื่องไม่ได้ต่อตรง
- **WHEN** Member มีเครื่องหนึ่งที่ไม่มีทางตรง
- **THEN** Machine ส่งซองผ่าน Hub ด้วย และเครื่องที่ต่อตรงได้ซองนั้นครั้งเดียว

### Requirement: ปิดทางตรงโดยไม่ทำซองหาย
ก่อนปิดทางตรง Controller SHALL ส่ง `direct.close` บนทางตรง แล้วอ่านทางตรงต่ออีกครู่หนึ่ง Machine SHALL เลิกเขียนบนทางตรงนั้นเมื่อได้ `direct.close` Controller SHALL ปิดทางตรงเมื่อแอปไปอยู่เบื้องหลัง และขอใหม่เมื่อกลับมา

#### Scenario: แอปไปเบื้องหลัง
- **WHEN** แอปไปอยู่เบื้องหลังขณะ Machine กำลังตอบ
- **THEN** คำตอบมาถึงทางตรงระหว่างอ่านต่อ หรือผ่าน Hub หลังจากนั้น ไม่หาย

### Requirement: กุญแจที่ถูกถอนไม่มีทางตรง
Machine SHALL ปิดทางตรงของกุญแจที่ถูกถอน

#### Scenario: ถอนกุญแจของมือถือ
- **WHEN** ใบรับรองการถอนกุญแจของเครื่องหนึ่งมาถึง Machine
- **THEN** ทางตรงของเครื่องนั้นปิด
