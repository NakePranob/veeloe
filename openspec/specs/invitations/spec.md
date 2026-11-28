# invitations Specification

## Purpose

Invitation พาคนใหม่เข้า Workspace ด้วยลิงก์เดียว (ADR 0059) คนออกเลือก Agent ได้หลายตัวพร้อมระดับของแต่ละตัว จำนวนคนที่รับได้ และเวลาหมดอายุ ทุกคนที่เปิดลิงก์เป็นคำขอเข้า ซึ่งคนออกเทียบรหัสสั้นแล้วรับทีละคน Hub นับและปิดลิงก์ แต่ไม่เคยเป็นคนรับรองกุญแจ

## Requirements

### Requirement: เปิดลิงก์ด้วยลายเซ็นของคนออก
Hub SHALL รับ `invitation.open` ที่เซ็นโดย Controller ของ Workspace นั้น โดยมี `max` 1 ถึง 100 และ `expires` ไม่เกิน 7 วันข้างหน้า Hub SHALL ปิด Invitation เมื่อคนออกส่ง `invitation.close` ที่เซ็นเอง เมื่อรับครบ `max` หรือเมื่อเลย `expires`

#### Scenario: คนนอก Workspace
- **WHEN** Controller ของอีก Workspace ส่ง `invitation.open` หรือ `member.add` ด้วย id เดียวกัน
- **THEN** Hub ตอบ `hub.invitation_invalid`

### Requirement: คำขอเข้ามีหลักฐานจากรหัสลับของลิงก์
คนที่เปิดลิงก์ SHALL ส่ง `POST /invitation-requests` ซ้ำจนกว่าจะได้เข้า พร้อมกุญแจ ชื่อ และ HMAC ใต้รหัสลับของลิงก์ Hub SHALL ส่งต่อคำขอไปที่การเชื่อมต่อของคนออกโดยไม่เก็บไว้ และ Controller ของคนออก SHALL ทิ้งคำขอที่หลักฐานไม่ตรง Hub จึงสร้างคำขอหรือสลับกุญแจเองไม่ได้

#### Scenario: Hub สลับกุญแจ
- **WHEN** คำขอมีกุญแจที่ไม่ใช่กุญแจที่หลักฐานครอบ
- **THEN** หน้าเชิญของคนออกไม่แสดงคำขอนั้น

### Requirement: คนออกเทียบรหัสสั้นก่อนรับทีละคน
ทั้งสองฝั่ง SHALL แสดงรหัสหกตัวที่คำนวณจาก SHA-256 ของกุญแจคนขอ คนออก SHALL ยืนยันว่ารหัสตรงและยืนยันตัวตนใหม่ ก่อนเซ็น `member.add` ซึ่งตั้ง Member id ใหม่ให้กุญแจนั้น Hub SHALL ลงทะเบียนกุญแจ นับคนเข้า เก็บของที่คนออกฝากไว้ (Machine ที่คนนั้นได้สิทธิ์ ใต้ HMAC ของรหัสลับ) และส่งใบรับรองให้ทุกคนใน Workspace

#### Scenario: รับคนแรกจากลิงก์สองที่
- **WHEN** คนออกรับคำขอแรก
- **THEN** Hub ตอบคำขอถัดไปของคนนั้นด้วยของที่ฝากไว้ และอีกหนึ่งที่ยังว่าง

#### Scenario: ลิงก์เต็ม
- **WHEN** มี `member.add` เกินจำนวน `max`
- **THEN** Hub ตอบ `hub.invitation_closed` และคนที่เข้าแล้วยังรับของที่ฝากไว้ได้

### Requirement: Machine รับ Member และ Grant จากคนที่มีสิทธิ์
Runtime SHALL เพิ่ม Member จาก `member.add` เฉพาะเมื่อผู้เซ็นเป็น Owner หรือ Member ที่มี Manage ที่ Agent ใดบน Machine นั้น และ SHALL ไม่ทับ Member id หรือกุญแจที่มีอยู่ หรือกุญแจที่ถูกถอน หลังรับ คนออก SHALL ส่ง `grant.set` ของแต่ละ Agent ไปที่ Machine ของ Agent นั้น

#### Scenario: คนที่เข้าใช้ Agent ที่ได้
- **WHEN** คนที่เข้าด้วยลิงก์ที่ให้ Use ที่ `shared` ส่ง `task.message` ถึง `shared` และถึง `private`
- **THEN** Turn ที่ `shared` จบ และ `private` ตอบ `agent.forbidden`

### Requirement: Owner เอา Member ออกจาก Workspace
Hub SHALL รับใบรับรอง `member.remove` ที่ `POST /member-removals` เฉพาะเมื่อผู้เซ็นเป็น Owner ของ Workspace และคนที่ถูกเอาออกเข้ามาด้วยลิงก์เชิญ ไม่ใช่ Owner อย่างอื่นตอบ `hub.member_remove_invalid` เมื่อรับแล้ว Hub SHALL ตัดกุญแจทุกเครื่องของคนนั้นและส่งใบรับรองถึงทุก Machine Runtime SHALL รับ `member.remove` เฉพาะจากกุญแจของ Owner แล้วถอนกุญแจและ Grant ทุกตัวของคนนั้น

#### Scenario: Member พยายามเอา Owner ออก
- **WHEN** Member ที่ถูกเชิญเซ็น `member.remove` ที่ชี้ Owner
- **THEN** Hub ตอบ `hub.member_remove_invalid` และไม่มีอะไรเปลี่ยน

#### Scenario: Owner เอา Member ออก
- **WHEN** Owner เซ็น `member.remove` ที่ชี้ Member ที่เข้ามาด้วยลิงก์
- **THEN** `trust.json` บน Machine ไม่มีกุญแจและ Grant ของคนนั้นอีก
