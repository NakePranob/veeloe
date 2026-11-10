# Spec Delta

## Purpose

กำหนดการส่งไฟล์จาก Controller ไปยัง Machine ใน Task และให้ Agent อ่านไฟล์จาก Workdir โดย Hub ไม่เก็บเนื้อหา

คำศัพท์: **Attachment** คือไฟล์ที่ประกาศใน `task.message` ด้วย name/size/hash; **Chunk** คือก้อน base64url ของไฟล์; **Uploads** คือที่พัก chunk ใน Runtime

## ADDED Requirements

### Requirement: ส่งไฟล์เข้า Task
Controller SHALL ส่ง `file.chunk` ครบทุกก้อนก่อน `task.message`; `task.message` MUST ประกาศ attachment name, size และ hash; Runtime MUST ตรวจ hash และขนาดก่อนเขียนไฟล์

#### Scenario: ส่งไฟล์สำเร็จ
- **WHEN** Controller ส่ง chunks ครบและ hash ตรง
- **THEN** Runtime เขียนไฟล์ที่ `workdir/attachments/<task>/<name>` และ Agent เห็น path

#### Scenario: Hash ไม่ตรง
- **WHEN** เนื้อหา chunk ไม่ตรง hash ที่ประกาศ
- **THEN** Runtime ปฏิเสธและไม่เขียนไฟล์

#### Scenario: ไฟล์ใหญ่เกิน
- **WHEN** attachment เกิน 20 MB
- **THEN** Runtime ปฏิเสธ

### Requirement: Hub ไม่เก็บไฟล์
Hub MUST ส่งต่อ `file.chunk` ตามหัวซองโดยไม่เก็บเนื้อหา

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ไม่ได้ต่อ Hub
- **THEN** การส่งไฟล์ล้มเหลวและ Controller ไม่ถือว่าสำเร็จ
