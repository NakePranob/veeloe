# Spec Delta

## ADDED Requirements

### Requirement: event คู่ของ Approval อยู่ใน log แบบต่อท้ายอย่างเดียว
Task log SHALL มี event kind ใหม่สองตัวคือ `approval.requested` กับ `approval.answered` ซึ่งเป็น event แบบต่อท้ายอย่างเดียวเหมือน event อื่นและ MUST NOT ถูกแก้หรือลบ `body` ของ `approval.requested` SHALL มีรหัสคำขอ คำสั่งเต็มที่ขอ รายการท่อนที่แยกแล้ว และเวลาหมดอายุ `body` ของ `approval.answered` SHALL มีรหัสคำขอ Member ที่ตอบ และการตัดสินใจ

#### Scenario: ขอแล้วตอบ
- **WHEN** worker ขอ Approval แล้ว Owner ตอบอนุมัติ
- **THEN** log มี `approval.requested` ตามด้วย `approval.answered` ที่มีรหัสคำขอเดียวกันตามลำดับ

#### Scenario: เริ่มใหม่แล้วยังอยู่
- **WHEN** worker เริ่มใหม่หลังขอ Approval
- **THEN** event ทั้งสองตัวยังอยู่ด้วยเลขเดิม
