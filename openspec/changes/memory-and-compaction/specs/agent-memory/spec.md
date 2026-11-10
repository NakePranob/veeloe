# Spec Delta

## Purpose

กำหนด `MEMORY.md` ที่ Runtime ใส่เข้า system prompt ของทุก Turn ใหม่ พร้อมเพดาน 4,000 ตัวอักษร

คำศัพท์: **Memory** คือ `MEMORY.md` ที่ root ของ Workdir; **Turn ใหม่** คือ Turn ที่เริ่มหลังข้อความ Member; **Cap** คือ 4,000 ตัวอักษร

## ADDED Requirements

### Requirement: Runtime ใส่ Memory ใน prompt
Runtime SHALL อ่าน `MEMORY.md` จาก Workdir ตอนเริ่ม Turn และใส่เนื้อหาใน system prompt; Memory MUST ถูกตรึงตลอด Turn; การแก้ไฟล์กลาง Turn MUST มีผลเฉพาะ Turn ถัดไป

#### Scenario: มี Memory
- **WHEN** Agent เริ่ม Turn ใหม่และมี `MEMORY.md`
- **THEN** system prompt มีเนื้อหา Memory ก่อนคำขอแรกของ Turn

#### Scenario: ไม่มี Memory
- **WHEN** ไม่มีไฟล์ `MEMORY.md`
- **THEN** system prompt ใช้ข้อความมาตรฐานเดิม

### Requirement: Memory มีเพดาน
Runtime MUST ตัด Memory ที่เกิน 4,000 ตัวอักษรและต่อท้ายด้วยข้อความบอก Agent ให้ย่อ; Runtime MUST NOT ส่งเกินเพดาน

#### Scenario: ไฟล์ยาวเกิน
- **WHEN** `MEMORY.md` ยาวกว่า 4,000 ตัวอักษร
- **THEN** prompt มี 4,000 ตัวแรกและข้อความให้ย่อ
