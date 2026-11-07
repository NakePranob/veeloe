# Spec Delta

## ADDED Requirements

### Requirement: agent.update รับ allowlist ทั้งชุด
`agent.update` SHALL รับ field `allowlist` ที่ไม่บังคับ เป็นรายการ string ทั้งชุด supervisor SHALL ตรวจรูปเหมือนตอนสร้าง และ SHALL เขียนทับของเดิมในขั้นเดียวให้อยู่รอดข้ามการเริ่มใหม่ การเปลี่ยน SHALL มีผลกับคำขอถัดไปของ worker โดยไม่ตัด Turn ที่ทำอยู่ และ SHALL ส่ง `agent.listed` ใหม่ถึงทุก Member ใน trust เหมือนการแก้อื่น

#### Scenario: เพิ่มรายการระหว่างรอ
- **WHEN** Owner ส่ง `agent.update` ที่เพิ่ม `npm test` ขณะมีคำขอ Approval ของ `npm test` รออยู่
- **THEN** Allowlist ใหม่มีผลกับคำขอถัดไป และ `agent.listed` ใหม่ถึงทุกเครื่อง

#### Scenario: รูปผิด
- **WHEN** `agent.update` มี `allowlist` ที่ไม่ใช่รายการ string
- **THEN** ซองไม่ผ่านและ Allowlist เดิมไม่เปลี่ยน
