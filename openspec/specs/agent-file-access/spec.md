# agent-file-access Specification

## Purpose

Agent แต่ละตัวมีระดับการเข้าถึงไฟล์ (ADR 0087): ในโฟลเดอร์ของตัวเองเป็นค่าเริ่มต้น และโฟลเดอร์บนเครื่องที่ Owner ให้ทีละโฟลเดอร์แบบอ่านอย่างเดียว

## Requirements

### Requirement: Owner ให้โฟลเดอร์ที่เลือก
Runtime SHALL รับ `files` และ `folders` ใน `agent.update` จากกุญแจของ Owner เท่านั้น คำขอจากคนอื่น SHALL ได้ `files.forbidden` แต่ละโฟลเดอร์ SHALL ถูกเก็บเป็น path จริงที่ resolve symlink แล้ว

#### Scenario: Owner ให้โปรเจกต์บนเครื่อง
- **WHEN** Owner ส่ง `files: "selected"` กับโฟลเดอร์ `~/code/shop`
- **THEN** `agent.listed` บอกระดับ `selected` และโฟลเดอร์นั้นเป็น path จริง

#### Scenario: Member ที่ไม่ใช่ Owner
- **WHEN** Member ที่ไม่ใช่ Owner ส่ง `files`
- **THEN** Runtime ตอบ `files.forbidden` และค่าเดิมไม่เปลี่ยน

### Requirement: โฟลเดอร์ต้องห้าม
Runtime SHALL ปฏิเสธด้วย `folder.forbidden` โฟลเดอร์ที่เป็นหรือครอบ home, ที่เก็บความลับ (`.ssh`, `.aws`, Keychain, ข้อมูล browser และอื่นๆ), โฟลเดอร์ของ Runtime หรือโฟลเดอร์ของระบบ และโฟลเดอร์ที่อยู่ข้างในที่เก็บความลับหรือโฟลเดอร์ของระบบ ทั้งตอนรับคำสั่งและทุกครั้งที่ worker เริ่ม เมื่อไม่รู้ว่า home อยู่ที่ไหน SHALL ปฏิเสธทุกโฟลเดอร์

#### Scenario: symlink เข้า .ssh
- **WHEN** โฟลเดอร์ที่ให้เป็น symlink ที่ชี้เข้า `~/.ssh`
- **THEN** Runtime ปฏิเสธด้วย `folder.forbidden`

#### Scenario: โฟลเดอร์ที่ครอบ home
- **WHEN** Owner ให้ `/Users`
- **THEN** Runtime ปฏิเสธด้วย `folder.forbidden`

### Requirement: sandbox อ่านได้แต่เขียนไม่ได้
worker ของ Agent ระดับ `selected` SHALL อ่านโฟลเดอร์ที่ให้ได้ SHALL NOT เขียนในนั้น และ SHALL NOT อ่านโฟลเดอร์อื่นนอกขอบเขตเดิม การเปลี่ยนระดับหรือโฟลเดอร์ SHALL เริ่ม worker ใหม่ด้วย sandbox ใหม่ และ `turn.started` SHALL บันทึกระดับที่ใช้

#### Scenario: คำสั่งใน Turn
- **WHEN** คำสั่งอ่านไฟล์ในโฟลเดอร์ที่ให้ แล้วพยายามเขียนไฟล์ในนั้น และอ่านโฟลเดอร์ข้างๆ
- **THEN** อ่านได้ เขียนไม่ได้ และโฟลเดอร์ข้างๆ อ่านไม่ได้
