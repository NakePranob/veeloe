# device-names Specification

## Purpose
กำหนดการเปลี่ยนชื่อ Controller ในหน้า My devices หลัง Link ไว้ในฐานข้อมูลของ Controller เครื่องนั้น โดยไม่เปลี่ยนชื่อบน Controller เครื่องอื่นและไม่ติดต่อ Hub

คำศัพท์: **Device name** คือชื่อที่แสดงในหน้า My devices; **Local rename** คือการแก้ `device.name` ในเครื่องที่กำลังใช้อยู่; **Linked name** คือชื่อที่มากับ `device.link`

## Requirements

### Requirement: เปลี่ยนชื่อ Controller ที่ยังใช้งานในเครื่องนี้
Controller SHALL เปิดให้แก้ `device.name` ของ Controller ที่ `revoked_at` เป็น NULL ผ่านหน้า My devices และ SHALL บันทึกลง `device` table ของเครื่องนั้นทันที; ชื่อใหม่ MUST ไม่ว่างและ MUST NOT ซ้ำกับ Controller อื่นที่ยังใช้งานของ Member เดียวกัน

#### Scenario: เปลี่ยนชื่อสำเร็จ
- **WHEN** ผู้ใช้เปิด My devices เลือก Controller ที่ยังใช้งาน พิมพ์ชื่อใหม่ที่ไม่ว่างและไม่ซ้ำ แล้วกด Save
- **THEN** `device.name` ถูกอัปเดต และหน้าแสดงชื่อใหม่ทันที

#### Scenario: ชื่อว่างหรือซ้ำ
- **WHEN** ผู้ใช้บันทึกชื่อว่าง หรือชื่อเดียวกับ Controller อื่นที่ยังใช้งาน
- **THEN** ระบบไม่บันทึกและบอกเหตุผล

#### Scenario: Controller ที่ถูก revoke
- **WHEN** Controller มี `revoked_at` ไม่เป็น NULL
- **THEN** ไม่มีช่อง/ปุ่ม rename และ model ปฏิเสธการแก้ชื่อ

### Requirement: Rename ไม่เปลี่ยนชื่อบนเครื่องอื่น
Local rename MUST NOT ส่ง certificate หรือแก้ชื่อ Controller ในเครื่องอื่น; ชื่อบนเครื่องอื่นยังเป็น Linked name เดิมจนกว่าจะมี change ซิงก์ชื่อ

#### Scenario: เครื่องอื่นยังเห็นชื่อเดิม
- **WHEN** Controller เครื่อง A เปลี่ยนชื่อเป็น "Work phone"
- **THEN** Controller เครื่อง B ยังแสดง Linked name เดิมของเครื่อง A
