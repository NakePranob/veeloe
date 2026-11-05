# runtime-hub-link Specification

## Purpose

กำหนดว่า Runtime เก็บกุญแจของ Machine อย่างไร ต่อเข้า Hub ที่ไหน และรักษาการเชื่อมต่ออย่างไร เพื่อให้ Machine ออนไลน์เองโดยไม่ต้องมีคนดูแล

## Requirements

### Requirement: กุญแจของ Machine สร้างครั้งเดียวและเป็นส่วนตัว
Runtime SHALL สร้างกุญแจ Ed25519 ครั้งแรกที่ต้องใช้ เก็บเป็นไฟล์ที่เจ้าของอ่านเขียนได้คนเดียวในโฟลเดอร์ของ Runtime และใช้ดอกเดิมทุกครั้ง Runtime MUST NOT ทำงานด้วยกุญแจที่ผู้ใช้อื่นอ่านได้

#### Scenario: เริ่มครั้งแรก
- **WHEN** ยังไม่มีไฟล์กุญแจ
- **THEN** Runtime สร้างไฟล์สิทธิ์ 0600

#### Scenario: เริ่มครั้งต่อไป
- **WHEN** มีไฟล์กุญแจอยู่แล้ว
- **THEN** Runtime ใช้กุญแจเดิม

#### Scenario: คนอื่นอ่านได้
- **WHEN** ไฟล์กุญแจเปิดให้ผู้ใช้อื่นอ่าน
- **THEN** Runtime ไม่เริ่มทำงาน และบอกวิธีแก้

### Requirement: Runtime รู้ว่าต้องต่อ Hub ไหน
`veeloe pair --hub <url>` SHALL บันทึก URL ของ Hub ลงโฟลเดอร์ของ Runtime เมื่อ Pairing สำเร็จ `veeloe` SHALL ใช้ค่านั้น และ `VEELOE_HUB_URL` SHALL ใช้แทนได้ ถ้าไม่มี Hub URL Runtime SHALL บอกวิธีตั้ง

#### Scenario: ไม่มี URL
- **WHEN** รัน `veeloe pair` โดยไม่ระบุ Hub และไม่มีค่าที่บันทึกไว้
- **THEN** Runtime จบพร้อมบอกวิธีระบุ

#### Scenario: หลัง Pairing
- **WHEN** รัน `veeloe` หลัง Pairing สำเร็จ
- **THEN** Runtime ต่อ Hub ตัวเดิมโดยไม่ต้องระบุอีก

### Requirement: Runtime พิสูจน์กุญแจและต่อใหม่เอง
Runtime SHALL ตอบ challenge ของ Hub ด้วยกุญแจของ Machine และ SHALL ต่อใหม่พร้อมเว้นระยะที่ยาวขึ้นเมื่อสายหลุดหรือเปิดไม่ได้ จนกว่าจะถูกสั่งหยุด

#### Scenario: Hub รับกุญแจ
- **WHEN** กุญแจเป็นของ Machine ที่ Hub รู้จัก
- **THEN** Runtime ได้ `hub.ready` และรายงานว่าต่อแล้ว

#### Scenario: Hub ยังไม่รู้จักกุญแจ
- **WHEN** Hub ปิดสายด้วย error การพิสูจน์ตัวตน ระหว่างรอ Pairing
- **THEN** Runtime ลองใหม่จนกว่าจะต่อได้หรือหมดเวลา

#### Scenario: สายหลุด
- **WHEN** สายที่ต่ออยู่หลุด
- **THEN** Runtime ต่อใหม่เอง และเว้นระยะกลับไปสั้นเมื่อต่อสำเร็จ

### Requirement: Runtime รับเฉพาะซองจากกุญแจที่ไว้ใจ
หลัง Pairing Runtime SHALL ตรวจทุกซองกับกุญแจที่ไว้ใจก่อนอ่าน ซองที่ไม่ผ่าน SHALL ถูกทิ้ง เลขลำดับที่รับแล้ว SHALL อยู่รอดข้ามการเริ่มใหม่

#### Scenario: กุญแจที่ไม่รู้จัก
- **WHEN** ซองเซ็นด้วยกุญแจที่ไม่ได้ไว้ใจ
- **THEN** Runtime ทิ้งซองนั้น

#### Scenario: ส่งซ้ำหลังเริ่มใหม่
- **WHEN** ซองเก่าถูกส่งซ้ำหลัง Runtime เริ่มใหม่
- **THEN** Runtime ทิ้งซองนั้น
