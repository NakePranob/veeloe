## Purpose

กำหนดว่า Owner ตั้ง Provider บน Machine อย่างไร และ supervisor ส่งคำขอไป LLM แทน worker อย่างไร โดยที่ Agent ไม่เคยเห็น key ของ Provider (ADR 0042)

## ADDED Requirements

### Requirement: Owner ตั้ง Provider ที่หน้าเครื่อง
`veeloe provider add` SHALL รับชื่อ, base URL และ key ของ Provider ที่รองรับรูปแบบ Anthropic Messages โดย key SHALL ถูกอ่านจาก terminal แบบไม่แสดงบนจอหรือจาก stdin และ MUST NOT ถูกรับเป็น argument ของคำสั่ง ก่อนบันทึก Runtime SHALL ถามรายชื่อ model จาก Provider ด้วย key นั้น และ SHALL ไม่บันทึกเมื่อถามไม่สำเร็จ key SHALL ถูกเก็บในไฟล์ของ supervisor ที่เจ้าของอ่านเขียนได้คนเดียว และ MUST NOT ออกจาก Machine

#### Scenario: key ใช้ได้
- **WHEN** Owner รัน `veeloe provider add` แล้วใส่ URL กับ key ที่ Provider รับ
- **THEN** Runtime บันทึก Provider และแสดงจำนวน model ที่ใช้ได้

#### Scenario: key ใช้ไม่ได้
- **WHEN** Provider ตอบว่า key ไม่ถูกต้อง หรือติดต่อ URL ไม่ได้
- **THEN** Runtime ไม่บันทึกอะไร และบอกเหตุผลใน terminal

#### Scenario: ชื่อซ้ำ
- **WHEN** Owner เพิ่ม Provider ด้วยชื่อที่มีอยู่แล้ว
- **THEN** Runtime ปฏิเสธ และ Provider เดิมไม่เปลี่ยน

### Requirement: Owner ดูและลบ Provider ได้
`veeloe provider list` SHALL แสดงชื่อและ URL ของทุก Provider และ MUST NOT แสดง key `veeloe provider remove <name>` SHALL ลบ Provider นั้น Agent ที่ใช้ Provider ที่ถูกลบ SHALL จบ Turn ถัดไปด้วย error ที่บอกว่าไม่มี Provider แทนที่จะพัง

#### Scenario: ดูรายชื่อ
- **WHEN** Owner รัน `veeloe provider list`
- **THEN** terminal แสดงชื่อกับ URL และไม่มี key ส่วนใดเลย

#### Scenario: ลบ Provider ที่ Agent ใช้อยู่
- **WHEN** Owner ลบ Provider แล้วส่งข้อความหา Agent ที่ใช้ Provider นั้น
- **THEN** Turn จบด้วย error code `provider.missing`

### Requirement: worker คุยกับ LLM ผ่าน proxy ของ supervisor เท่านั้น
supervisor SHALL รับคำขอไป LLM จาก worker ผ่าน proxy ที่ฟังเฉพาะบนเครื่อง ใส่ key ของ Provider ที่ Agent ตัวนั้นใช้ แล้วส่งต่อ worker MUST NOT ได้รับ key ทั้งทางตัวแปร environment, IPC หรือคำตอบของ proxy proxy SHALL รับเฉพาะคำขอที่พกรหัสของ worker ที่ supervisor ออกให้ และ SHALL ใช้ Provider กับ model ของ Agent ที่รหัสนั้นเป็นเจ้าของ ไม่ใช่ค่าที่คำขอระบุ

#### Scenario: worker ขอ LLM
- **WHEN** worker ส่งคำขอพร้อมรหัสของตัวเอง
- **THEN** Provider ได้คำขอพร้อม key และ worker ได้คำตอบตามที่ Provider ตอบ

#### Scenario: คำขอที่ไม่มีรหัส
- **WHEN** โปรเซสบนเครื่องส่งคำขอไปที่ proxy โดยไม่มีรหัส หรือใช้รหัสที่ไม่ได้ออกให้
- **THEN** proxy ตอบปฏิเสธและไม่ติดต่อ Provider

#### Scenario: worker ขอ model อื่น
- **WHEN** คำขอของ worker ระบุ model ที่ไม่ใช่ของ Agent
- **THEN** Provider ได้คำขอด้วย model ของ Agent

#### Scenario: Provider ล่ม
- **WHEN** ติดต่อ Provider ไม่ได้ หรือ Provider ตอบ error
- **THEN** worker ได้ error ที่บอกว่าเป็นที่ Provider และ Turn จบด้วย code `provider.failed` หรือ `provider.unreachable`
