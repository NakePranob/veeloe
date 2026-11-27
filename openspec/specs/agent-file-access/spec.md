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

### Requirement: โฟลเดอร์อ่านเขียนมีคนเขียนได้คนเดียว
โฟลเดอร์ที่เลือก SHALL ตั้งเป็น `read` หรือ `write` ได้ Runtime SHALL ปฏิเสธด้วย `folder.taken` พร้อมชื่อ Agent ที่ถืออยู่ เมื่อ Agent อื่นเขียนโฟลเดอร์นั้น โฟลเดอร์ที่อยู่ข้างใน หรือโฟลเดอร์ที่ครอบมันอยู่ (ADR 0037) คำสั่งที่เขียนในโฟลเดอร์อ่านเขียน SHALL จอง write lock ของ Agent เหมือนเขียนใน Workdir (ADR 0080)

#### Scenario: Agent อื่นเขียนโฟลเดอร์ที่ซ้อนกัน
- **WHEN** a1 เขียน `~/code/shop` และ Owner ให้ a2 เขียน `~/code/shop/web` หรือ `~/code`
- **THEN** Runtime ตอบ `folder.taken` ที่บอกชื่อ a1 และ a2 ยังอ่าน `~/code/shop` ได้ถ้าให้แบบอ่านอย่างเดียว

#### Scenario: คำสั่งเขียนในโฟลเดอร์อ่านเขียน
- **WHEN** คำสั่งเขียนไฟล์ในโฟลเดอร์ที่ให้แบบอ่านเขียน
- **THEN** ไฟล์ถูกเขียน ส่วนโฟลเดอร์อ่านอย่างเดียวข้างๆ ยังเขียนไม่ได้

### Requirement: ทั้งเครื่องยกเว้น Runtime
Agent ระดับ `machine` SHALL อ่านและเขียนได้ทุกไฟล์ที่ user ของ Runtime เข้าถึง ยกเว้นโฟลเดอร์ของ Runtime (`VEELOE_HOME`) ซึ่งรวมโฟลเดอร์ของ Agent อื่นและ Task log แต่ SHALL ยังเข้าโฟลเดอร์ของตัวเองได้ เครือข่าย SHALL ยังออกได้แค่ผ่าน proxy ของ Egress และ Approval SHALL ทำงานเหมือนเดิม Controller SHALL ให้ยืนยันด้วยข้อความที่บอกว่า Agent จะอ่าน แก้ และลบอะไรได้ก่อนเซ็น

#### Scenario: อ่านไฟล์นอก Workdir
- **WHEN** คำสั่งของ Agent ระดับ `machine` อ่านและเขียนไฟล์นอกโฟลเดอร์ของมัน
- **THEN** ทำได้

#### Scenario: แตะโฟลเดอร์ของ Runtime
- **WHEN** คำสั่งเดียวกันอ่าน `providers.json` ของ Runtime หรือ Workdir ของ Agent อื่น
- **THEN** ถูกปฏิเสธ
