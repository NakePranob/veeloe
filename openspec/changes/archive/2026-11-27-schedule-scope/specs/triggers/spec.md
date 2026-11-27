## ADDED Requirements

### Requirement: scope ของ Schedule
`trigger.set` SHALL รับ `allow` ได้ (ไม่บังคับ) เป็นรายการแบบเดียวกับ Allowlist คือมีได้ไม่เกิน 100 รายการ แต่ละรายการยาว 1 ถึง 500 ตัวอักษร ทั้งสองฝั่งของ Protocol SHALL ตัดสินรายการนี้ตรงกันตาม vectors `allow` ที่ไม่ว่าง SHALL เซ็นโดยคนที่มี Approve ที่ Agent นั้น ถ้าไม่ใช่ SHALL ตอบ `trigger.forbidden` `trigger.listed` SHALL ส่ง `allow` ของแต่ละ Trigger มาด้วย `trigger.set` ที่แทน Trigger เดิมที่มี `schedule` เหมือนเดิม SHALL ไม่เปลี่ยนรอบถัดไปและสถานะพัก

#### Scenario: เพิ่มคำสั่งเข้า scope
- **WHEN** Member ที่มี Approve ส่ง `trigger.set` ของ Schedule เดิมที่มี `allow: ["curl"]`
- **THEN** `trigger.listed` แสดง `allow: ["curl"]` และ `nextRunAt` เท่าเดิม

#### Scenario: scope ที่ไม่ใช่รายการ
- **WHEN** `allow` ไม่ใช่ array of string หรือมีรายการว่าง
- **THEN** ซองไม่ผ่านการตรวจทั้งสองฝั่ง

### Requirement: รอบที่ไม่มีคนเฝ้าไม่ขอ Approval
รอบที่ถึงเวลาเอง SHALL ไม่ขอ Approval คำสั่ง bash หรือ tool ที่ไม่ผ่าน Allowlist ของ Agent และไม่ผ่าน `allow` ของ Schedule ตามกฎเทียบเดียวกัน SHALL ถูกปฏิเสธทันที และโดเมนที่อยู่นอก Egress ก็ SHALL ถูกปฏิเสธทันทีเช่นกัน ทุกครั้งที่ปฏิเสธ SHALL เขียน event `approval.skipped` ที่มี `command` กับ `parts` หรือ `domain` ลง Task ของรอบนั้น รอบที่มี `approval.skipped` SHALL จบแบบ `quiet` ไม่ได้ ถ้าคนเซ็นไม่มี Approve แล้ว รอบนั้น SHALL ใช้ scope ว่าง `turn.started` และ `member.message` ของรอบ Trigger SHALL มี `trigger.attended` บอกว่ามีคนเฝ้าหรือไม่

#### Scenario: คำสั่งอยู่ใน scope
- **WHEN** รอบที่ถึงเวลาเองรัน `curl -s example.com` และ `allow` มี `curl`
- **THEN** คำสั่งนั้นรันได้ ไม่มี `approval.requested`

#### Scenario: คำสั่งอยู่นอก scope
- **WHEN** รอบที่ถึงเวลาเองรันคำสั่งที่ไม่อยู่ทั้งใน Allowlist และ `allow`
- **THEN** ไม่มี `approval.requested` Task มี `approval.skipped` ที่มีคำสั่งนั้น และ Agent ได้ผลว่าคำสั่งไม่ได้รัน

#### Scenario: พยายามจบเงียบหลังถูกปฏิเสธ
- **WHEN** รอบที่มี `approval.skipped` แล้ว Agent เรียก `nothing_to_report`
- **THEN** Turn ไม่จบด้วย `quiet`

#### Scenario: รันเลยตอน Agent ไม่ว่าง
- **WHEN** Member ส่ง `trigger.run` ระหว่างที่ Agent กำลังทำ Turn อื่น
- **THEN** Controller ได้ error code `agent.busy` และไม่มีรอบไหนต่อคิวไว้

#### Scenario: รันเลยมีคนเฝ้า
- **WHEN** Member ส่ง `trigger.run` และรอบนั้นรันคำสั่งนอก scope
- **THEN** Machine ขอ Approval ตามปกติ และ `turn.started` มี `trigger.attended: true`

### Requirement: รอบที่ข้ามล่าสุด
เมื่อข้ามรอบเพราะ Agent ไม่ว่างหรือ Budget หมด supervisor SHALL เก็บเวลาของรอบนั้นและเหตุผล (`busy` หรือ `budget`) และ `trigger.listed` SHALL ส่ง `lastSkip` (`at`, `why`) ของรอบที่ข้ามครั้งล่าสุด

#### Scenario: Agent ไม่ว่างตอนถึงรอบ
- **WHEN** ถึงรอบตอนที่ Agent กำลังทำ Turn อื่น
- **THEN** `trigger.listed` มี `lastSkip` ที่มี `why: "busy"` และ `at` เป็นเวลาของรอบนั้น
