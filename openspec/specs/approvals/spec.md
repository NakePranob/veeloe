# approvals Specification

## Purpose

Approval คือคำขอที่ Agent ส่งให้ Member ที่มี Approve อนุมัติก่อนทำสิ่งที่ไม่อยู่ใน Allowlist ระหว่างรอ Task หยุดรอ Turn นั้นไว้จนมีคำตอบหรือหมดเวลา แล้วผลกลับไปถึง LLM

## Requirements

### Requirement: คำขอ Approval หยุด Turn ไว้จนมีคำตอบหรือหมดเวลา
เมื่อ LLM ขอคำสั่งที่ไม่อยู่ใน Allowlist worker SHALL เขียน event `approval.requested` ลง log ของ Task แล้วหยุด Turn นั้นไว้โดยไม่เรียก tool ใดต่อจนกว่าจะได้คำตอบ เมื่อได้คำตอบว่าไม่อนุมัติ หมดเวลา หรือไม่มีคนตอบได้ worker SHALL ส่งผลที่เป็น error ให้ LLM ว่าไม่ได้รับอนุมัติ แล้ว Turn SHALL เดินต่อได้ ค่าเริ่มต้นของเวลาหมดอายุ SHALL เป็น 1 ชั่วโมง และคนที่มี Manage SHALL ตั้งได้ต่อ Agent

#### Scenario: ขอแล้วรอ
- **WHEN** LLM ขอ `rm -rf dist` ที่ไม่อยู่ใน Allowlist
- **THEN** log มี `approval.requested` และ LLM ยังไม่ได้ผลจนกว่าจะมีคำตอบ

#### Scenario: หมดเวลา
- **WHEN** ครบเวลาหมดอายุแล้วยังไม่มีคนตอบ
- **THEN** LLM ได้ผลที่เป็น error ว่าหมดเวลา และ Turn เดินต่อ

#### Scenario: ถูกปฏิเสธ
- **WHEN** Member ตอบปฏิเสธคำขอ
- **THEN** LLM ได้ผลที่เป็น error ว่าถูกปฏิเสธ และ Turn เดินต่อ

#### Scenario: ตั้งเวลาหมดอายุต่อ Agent
- **WHEN** Owner ส่ง `agent.update` ที่มี `approvalTimeoutS` เป็น 300
- **THEN** คำขอถัดไปของ Agent นั้นหมดเวลาใน 5 นาที และหน้า Allowlist แสดง 5 นาที

### Requirement: เฉพาะ Member ที่มี Approve ที่ Agent นั้นตอบได้
คำตอบ Approval SHALL มาจาก Member ที่มี Grant ระดับ Approve ขึ้นไปที่ Agent ตัวนั้น (ใน v0.1 คือ Owner ทุกคน) Member ที่มีแค่ Use SHALL ตอบไม่ได้ คนที่มี Approve SHALL เปิดอ่าน Task ที่ขออนุมัติได้เมื่อต้องการ และการเปิด SHALL ถูกบันทึกไว้ใน Task

#### Scenario: คนที่ไม่มี Approve
- **WHEN** Member ที่มีแค่ Use ส่งคำตอบ Approval
- **THEN** supervisor ทิ้งคำตอบนั้นและ Turn ยังรออยู่

### Requirement: ข้อความ approval.answer จาก Controller ถึง Machine
Protocol SHALL มีข้อความ `approval.answer` จาก Controller ถึง Machine ที่มีรหัส Agent รหัสคำขอ (มากับ Task ของซอง) และการตัดสินใจอย่างใดอย่างหนึ่งคืออนุมัติครั้งเดียว ปฏิเสธ หรือบอกให้ทำอย่างอื่นพร้อมข้อความ และมีคำนำหน้า `allowAlways` ที่ไม่บังคับสำหรับปุ่มอนุญาตตลอด ข้อความ SHALL ถูกเซ็นและตรวจเหมือนข้อความอื่นของ Controller

#### Scenario: ต้องยืนยันตัวก่อนอนุมัติ
- **WHEN** Owner กดอนุมัติหรืออนุญาตตลอดในแอป
- **THEN** Controller ขอยืนยันตัว (Face ID, ลายนิ้วมือ หรือ passkey) ก่อนเซ็น `approval.answer` และถ้าไม่ผ่านจะไม่มีซองออกไป (ADR 0012)

#### Scenario: ตอบอนุมัติ
- **WHEN** Owner ส่ง `approval.answer` ที่อนุมัติด้วยรหัสคำขอที่รออยู่
- **THEN** worker ได้คำตอบนั้นและรันคำสั่งต่อ

#### Scenario: ตอบคำขอที่ไม่มี
- **WHEN** `approval.answer` มาถึงด้วยรหัสคำขอที่ไม่มีคำขอรออยู่
- **THEN** supervisor ตอบ error ว่าไม่พบคำขอ และไม่มีอะไรเปลี่ยน

### Requirement: event approval.answered บันทึกว่าใครตอบว่าอะไร
เมื่อมีคำตอบ worker SHALL เขียน event `approval.answered` ลง log ของ Task ที่มีรหัสคำขอ Member ที่ตอบ และการตัดสินใจ เมื่อคำขอหมดเวลาโดยไม่มีคนตอบ worker SHALL เขียน `approval.answered` ที่มีรหัสคำขอกับการตัดสินใจปฏิเสธโดยไม่มี Member event ทั้งสองตัว SHALL อยู่ใน log แบบต่อท้ายอย่างเดียวเหมือน event อื่น และ SHALL ถูกส่งถึง Member ที่เริ่ม Task เหมือน event อื่น

#### Scenario: ตอบแล้วมีบันทึก
- **WHEN** Owner ตอบอนุมัติคำขอหนึ่ง
- **THEN** log มี `approval.answered` ที่มีรหัสคำขอ Member ที่ตอบ และการตัดสินใจนั้น

### Requirement: การ์ด Approval ในหน้า Task ตอบได้ตามสิทธิ์
หน้า Task SHALL แสดงการ์ด Approval ต่อคำขอที่รออยู่หนึ่งการ์ด มีคำสั่งเต็มที่ขอ ชื่อ Agent และเวลาที่เหลือ การ์ด SHALL มีปุ่มอนุมัติ ปฏิเสธ และบอกให้ทำอย่างอื่นพร้อมช่องพิมพ์ กับปุ่มอนุญาตตลอดสำหรับ Member ที่มี Manage ปุ่มอนุญาตตลอด SHALL ให้แก้คำนำหน้าก่อนเซ็น และ SHALL บอกว่ารายการนั้นครอบคำสั่งไหนบ้าง เมื่อคำสั่งมีหลายท่อนแอป SHALL เสนอเฉพาะท่อนที่ยังไม่อยู่ในรายการ

#### Scenario: อนุมัติครั้งเดียว
- **WHEN** Owner กดอนุมัติบนการ์ดที่รออยู่
- **THEN** Controller ส่ง `approval.answer` ที่อนุมัติ และการ์ดแสดงว่าอนุมัติแล้ว

#### Scenario: อนุญาตตลอด
- **WHEN** Owner กดอนุญาตตลอด ตัดท้ายคำสั่งเหลือ `npm` แล้วกดยืนยัน
- **THEN** Controller ส่ง `approval.answer` ที่อนุมัติพร้อมคำนำหน้า `allowAlways` เป็น `npm` และ Allowlist ของ Agent มี `npm` เพิ่ม

#### Scenario: คนที่ไม่มี Manage
- **WHEN** Member ที่มีแค่ Approve เปิดการ์ด Approval
- **THEN** การ์ดไม่มีปุ่มอนุญาตตลอด
