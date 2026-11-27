# triggers Specification

## Purpose
Trigger คืองานที่ Member เซ็นไว้ล่วงหน้าให้ Agent เริ่มเองบน Machine โดยไม่ต้องมีใครส่งข้อความ Schedule เป็น Trigger ชนิดแรก ซึ่งเริ่ม Task ใหม่ตามเวลาของ Machine แม้ Hub หรือ Controller จะออฟไลน์อยู่

## Requirements

### Requirement: ข้อความ trigger ใน Protocol
Protocol SHALL มีข้อความจาก Controller ถึง Machine คือ `trigger.set` (สร้างหรือแก้ทั้งอัน), `trigger.pause`, `trigger.resume`, `trigger.delete`, `trigger.run` และ `trigger.list` และคำตอบ `trigger.listed` จาก Machine ทุกข้อความ SHALL มี `agent` และข้อความที่ระบุ Trigger อันเดียว SHALL มี `id` ข้อความ SHALL ถูกเซ็นและตรวจเหมือนข้อความอื่นของ Controller ทั้งสองฝั่งของ Protocol SHALL ตัดสินซองเดียวกันตรงกันตาม vectors

#### Scenario: Schedule ทุก 15 นาที
- **WHEN** Controller ส่ง `trigger.set` ชนิด `schedule` ที่มี `every.minutes` เป็น 15 และข้อความที่จะสั่ง
- **THEN** ซองผ่านการตรวจทั้งฝั่ง Rust และ TypeScript

#### Scenario: ถี่เกินไป
- **WHEN** `every.minutes` น้อยกว่า 15
- **THEN** ซองไม่ผ่านการตรวจทั้งสองฝั่ง

#### Scenario: เวลาไม่ใช่เวลา
- **WHEN** `daily.at` ไม่ใช่ `HH:MM` ที่อยู่ในช่วง 00:00 ถึง 23:59 หรือ `weekly.day` ไม่อยู่ใน 0 ถึง 6
- **THEN** ซองไม่ผ่านการตรวจทั้งสองฝั่ง

### Requirement: Machine เก็บ Trigger ที่เซ็นแล้ว
supervisor SHALL เก็บ Trigger แต่ละอันไว้ในโฟลเดอร์ของตัวเองนอก sandbox ทุกตัว พร้อม `id`, `kind`, `agent`, `member`, กุญแจที่เซ็น, ข้อความ, เวลาของ Schedule, สถานะพัก, เวลาที่รันล่าสุด และซองที่เซ็นทั้งซอง ตอนรับ supervisor SHALL ตรวจว่ากุญแจยังไม่ถูกถอนและคนเซ็นมี Use ที่ Agent นั้น ถ้าไม่ผ่าน SHALL ตอบ error และไม่เก็บ `trigger.set` ที่มี `id` เดิม SHALL แทนที่อันเดิมทั้งอัน

#### Scenario: สร้าง Schedule
- **WHEN** Member ที่มี Use ส่ง `trigger.set` ที่ผ่านการตรวจ
- **THEN** Machine เก็บ Trigger นั้นและตอบ `trigger.listed` ของ Agent นั้นที่มี Trigger ใหม่

#### Scenario: ไม่มีสิทธิ์
- **WHEN** คนเซ็นไม่มี Use ที่ Agent นั้น
- **THEN** Controller ได้ error code `trigger.forbidden` และไม่มีอะไรถูกเก็บ

#### Scenario: Agent ไม่มีบน Machine
- **WHEN** `trigger.set` ระบุ Agent ที่ Machine ไม่มี
- **THEN** Controller ได้ error code `agent.unknown`

#### Scenario: เก็บข้ามการเปิดเครื่องใหม่
- **WHEN** supervisor เริ่มใหม่
- **THEN** Trigger ที่เก็บไว้ยังอยู่ครบ พร้อมเวลาที่รันล่าสุด

### Requirement: จัดการ Trigger
`trigger.pause` SHALL หยุดรอบถัดไปของ Trigger นั้นจนกว่าจะ `trigger.resume`, `trigger.delete` SHALL ลบ Trigger นั้น, `trigger.run` SHALL เริ่มหนึ่งรอบทันทีโดยไม่เปลี่ยนรอบปกติ และ `trigger.list` SHALL ตอบ `trigger.listed` ที่มี Trigger ทุกอันของ Agent นั้น แต่ละอันมีสถานะพัก สถานะระงับ คนเซ็น เวลาที่รันล่าสุด และเวลารอบถัดไปที่ Machine คำนวณ ทุกข้อความยกเว้น `trigger.list` SHALL ตอบด้วย `trigger.listed` ด้วย

#### Scenario: พักแล้วกลับมา
- **WHEN** Member ส่ง `trigger.pause` แล้วรอบถึงเวลา
- **THEN** ไม่มี Task ใหม่ และหลัง `trigger.resume` รอบถัดไปรันตามปกติ

#### Scenario: รันทันที
- **WHEN** Member ส่ง `trigger.run`
- **THEN** Task ใหม่เริ่มทันที และเวลารอบถัดไปไม่เปลี่ยน

#### Scenario: Trigger ที่ไม่มี
- **WHEN** ข้อความระบุ `id` ที่ไม่มีใน Agent นั้น
- **THEN** Controller ได้ error code `trigger.unknown`

### Requirement: รอบของ Trigger เข้า harness
เมื่อถึงรอบ supervisor SHALL ตรวจซ้ำว่ากุญแจที่เซ็นยังไม่ถูกถอนและคนเซ็นยังมี Use แล้ว SHALL ส่งงานให้ worker ในนามคนเซ็นใน Task ใหม่ worker SHALL บันทึก `turn.started` ที่มี `member` และ `trigger` (`kind`, `id`, `at`) โดย `at` คือเวลาที่ควรรัน field ทั้งสอง SHALL เป็น field ที่ไม่บังคับ Controller ที่ไม่รู้จัก field นี้ SHALL ยังเปิด Task ได้ Task ที่มาจาก Trigger SHALL มองเห็นได้โดยคนที่ตั้ง Trigger

#### Scenario: ถึงรอบ
- **WHEN** Schedule ถึงเวลาที่ควรรัน
- **THEN** มี Task ใหม่ที่ `turn.started` บอก `trigger.kind: "schedule"`, `id` ของ Trigger, `at` และคนเซ็น

#### Scenario: ทำได้โดยไม่มี Hub
- **WHEN** Hub ออฟไลน์ตอนถึงรอบ
- **THEN** Task ยังเริ่มบน Machine ตามเวลา

### Requirement: Turn ที่ไม่มีอะไรต้องบอก
Turn ที่มาจาก Trigger SHALL มี tool `nothing_to_report` ส่วน Turn ปกติ SHALL NOT มี ถ้า Agent เรียก tool นี้ Turn SHALL จบด้วย `turn.ended` ที่มี `reason: "quiet"` และ Controller SHALL ไม่แสดง Task ที่ Turn ล่าสุดจบแบบ quiet ใน Inbox ถ้า Agent จบ Turn ด้วยข้อความ Task SHALL ขึ้นใน Inbox เหมือน Task ปกติ

#### Scenario: รอบที่เงียบ
- **WHEN** Agent เรียก `nothing_to_report` ใน Turn ของ Schedule
- **THEN** Turn จบแบบ `quiet` และ Task ไม่ขึ้นใน Inbox

#### Scenario: Turn ปกติไม่มี tool นี้
- **WHEN** Member ส่งข้อความเอง
- **THEN** คำขอถึง Provider ไม่มี tool `nothing_to_report`

### Requirement: เวลาของ Schedule
Schedule SHALL รองรับทุก N นาที (อย่างน้อย 15), ทุกวันตามเวลา `HH:MM` และทุกสัปดาห์ตามวัน (0 คือวันอาทิตย์) และเวลา โดยนับตามเวลาของ Machine และเก็บเป็นโครงสร้าง ไม่ใช่สตริง cron

#### Scenario: ทุกวัน
- **WHEN** Schedule ตั้งไว้ทุกวัน 09:00 และรันล่าสุดเมื่อวาน 09:00
- **THEN** รอบถัดไปคือวันนี้ 09:00 ตามเวลาของ Machine

#### Scenario: ทุกสัปดาห์
- **WHEN** Schedule ตั้งไว้ทุกวันจันทร์ 08:30
- **THEN** รอบถัดไปคือวันจันทร์ที่ใกล้ที่สุดหลังรอบล่าสุด เวลา 08:30

### Requirement: รอบที่ข้ามและรอบที่ชดเชย
Schedule SHALL ข้ามรอบเมื่อ Agent กำลังทำ Turn อยู่ หรือเมื่อ Budget ของวันนั้นหมด ถ้า supervisor เปิดขึ้นมาแล้วพบว่าพลาดรอบไปขณะเครื่องปิด SHALL รันชดเชยครั้งเดียว ไม่ว่าจะพลาดไปกี่รอบ และ `at` SHALL เป็นเวลาของรอบล่าสุดที่พลาด

#### Scenario: Agent ไม่ว่าง
- **WHEN** รอบถึงขณะที่ Agent กำลังทำ Turn อยู่
- **THEN** รอบนั้นถูกข้าม และไม่มี Task ใหม่

#### Scenario: Budget หมด
- **WHEN** รอบถึงหลัง Budget ของวันนั้นหมด
- **THEN** รอบนั้นถูกข้าม

#### Scenario: เครื่องปิดไปสามรอบ
- **WHEN** supervisor เปิดหลังพลาดรอบทุกวัน 09:00 มาสามวัน
- **THEN** มี Task ใหม่หนึ่ง Task ที่ `at` เป็นวันนี้ 09:00 หรือรอบล่าสุดที่ผ่านไป

### Requirement: ถอนกุญแจและถังขยะ
เมื่อกุญแจถูกถอน supervisor SHALL ระงับ Trigger ทุกอันที่กุญแจนั้นเซ็นทันที และ SHALL NOT รันอีก Agent ที่อยู่ในถังขยะ SHALL NOT รัน Trigger และ Trigger SHALL รันต่อตามปกติเมื่อกู้ Agent คืน

#### Scenario: ถอนกุญแจ
- **WHEN** กุญแจที่เซ็น Schedule ถูกถอน
- **THEN** Schedule นั้นขึ้นว่าระงับใน `trigger.listed` และไม่มีรอบใหม่

#### Scenario: กู้ Agent คืน
- **WHEN** Agent ที่มี Schedule ถูกลบแล้วกู้คืน
- **THEN** ระหว่างอยู่ในถังขยะไม่มีรอบ และหลังกู้คืนรอบถัดไปรันตามปกติ

### Requirement: usage แยกที่มา
token ของ Turn ที่มาจาก Schedule SHALL ถูกนับใน `usage` ด้วยที่มา `schedule` แยกจาก `task` และนับรวมใน Budget ก้อนเดิมของ Agent

#### Scenario: รอบของ Schedule ใช้ token
- **WHEN** Turn ของ Schedule ได้คำตอบจาก Provider
- **THEN** `usage` ของวันนั้นมีที่มา `schedule` ที่นับ token นั้น

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
