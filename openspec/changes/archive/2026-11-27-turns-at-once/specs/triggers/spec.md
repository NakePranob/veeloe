## MODIFIED Requirements

### Requirement: รอบที่ข้ามและรอบที่ชดเชย
Schedule SHALL ข้ามรอบเมื่อรอบก่อนของ Schedule เดียวกันยังไม่จบ หรือเมื่อ Budget ของวันนั้นหมด Turn ของ Task อื่นที่กำลังทำ SHALL ไม่ทำให้ข้ามรอบ (ADR 0080) ถ้า supervisor เปิดขึ้นมาแล้วพบว่าพลาดรอบไปขณะเครื่องปิด SHALL รันชดเชยครั้งเดียว ไม่ว่าจะพลาดไปกี่รอบ และ `at` SHALL เป็นเวลาของรอบล่าสุดที่พลาด

#### Scenario: Agent ไม่ว่าง
- **WHEN** รอบถึงขณะที่ Agent กำลังทำ Turn ของ Task อื่น
- **THEN** รอบนั้นเริ่มเป็น Task ใหม่ทันที

#### Scenario: รอบก่อนยังไม่จบ
- **WHEN** รอบถึงขณะที่ Turn ของรอบก่อนของ Schedule เดียวกันยังไม่จบ
- **THEN** รอบนั้นถูกข้าม และไม่มี Task ใหม่

#### Scenario: Budget หมด
- **WHEN** รอบถึงหลัง Budget ของวันนั้นหมด
- **THEN** รอบนั้นถูกข้าม

#### Scenario: เครื่องปิดไปสามรอบ
- **WHEN** supervisor เปิดหลังพลาดรอบทุกวัน 09:00 มาสามวัน
- **THEN** มี Task ใหม่หนึ่ง Task ที่ `at` เป็นวันนี้ 09:00 หรือรอบล่าสุดที่ผ่านไป

### Requirement: รอบที่ไม่มีคนเฝ้าไม่ขอ Approval
รอบที่ถึงเวลาเอง SHALL ไม่ขอ Approval คำสั่ง bash หรือ tool ที่ไม่ผ่าน Allowlist ของ Agent และไม่ผ่าน `allow` ของ Schedule ตามกฎเทียบเดียวกัน SHALL ถูกปฏิเสธทันที และโดเมนที่อยู่นอก Egress ก็ SHALL ถูกปฏิเสธทันทีเช่นกัน ทุกครั้งที่ปฏิเสธ SHALL เขียน event `approval.skipped` ที่มี `command` กับ `parts` หรือ `domain` ลง Task ของรอบนั้น รอบที่มี `approval.skipped` SHALL จบแบบ `quiet` ไม่ได้ ถ้าคนเซ็นไม่มี Approve แล้ว รอบนั้น SHALL ใช้ scope ว่าง `turn.started` และ `member.message` ของรอบ Trigger SHALL มี `trigger.attended` บอกว่ามีคนเฝ้าหรือไม่ `trigger.run` ระหว่างที่รอบก่อนของ Trigger เดียวกันยังไม่จบ SHALL ได้ error code `agent.busy` ส่วน Turn ของ Task อื่น SHALL ไม่ทำให้ได้ error นี้

#### Scenario: คำสั่งอยู่ใน scope
- **WHEN** รอบที่ถึงเวลาเองรัน `curl -s example.com` และ `allow` มี `curl`
- **THEN** คำสั่งนั้นรันได้ ไม่มี `approval.requested`

#### Scenario: คำสั่งอยู่นอก scope
- **WHEN** รอบที่ถึงเวลาเองรันคำสั่งที่ไม่อยู่ทั้งใน Allowlist และ `allow`
- **THEN** ไม่มี `approval.requested` Task มี `approval.skipped` ที่มีคำสั่งนั้น และ Agent ได้ผลว่าคำสั่งไม่ได้รัน

#### Scenario: พยายามจบเงียบหลังถูกปฏิเสธ
- **WHEN** รอบที่มี `approval.skipped` แล้ว Agent เรียก `nothing_to_report`
- **THEN** Turn ไม่จบด้วย `quiet`

#### Scenario: รันเลยตอนรอบก่อนยังไม่จบ
- **WHEN** Member ส่ง `trigger.run` ระหว่างที่รอบก่อนของ Trigger เดียวกันยังทำอยู่
- **THEN** Controller ได้ error code `agent.busy` และไม่มีรอบไหนต่อคิวไว้

#### Scenario: รันเลยตอน Agent ไม่ว่าง
- **WHEN** Member ส่ง `trigger.run` ระหว่างที่ Agent กำลังทำ Turn ของ Task อื่น
- **THEN** รอบนั้นเริ่มเป็น Task ใหม่ทันที

#### Scenario: รันเลยมีคนเฝ้า
- **WHEN** Member ส่ง `trigger.run` และรอบนั้นรันคำสั่งนอก scope
- **THEN** Machine ขอ Approval ตามปกติ และ `turn.started` มี `trigger.attended: true`

### Requirement: รอบที่ข้ามล่าสุด
เมื่อข้ามรอบเพราะรอบก่อนของ Trigger เดียวกันยังไม่จบหรือ Budget หมด supervisor SHALL เก็บเวลาของรอบนั้นและเหตุผล (`busy` หรือ `budget`) และ `trigger.listed` SHALL ส่ง `lastSkip` (`at`, `why`) ของรอบที่ข้ามครั้งล่าสุด `busy` SHALL หมายถึงรอบก่อนของ Trigger นั้นยังไม่จบ

#### Scenario: Agent ไม่ว่างตอนถึงรอบ
- **WHEN** ถึงรอบตอนที่รอบก่อนของ Schedule เดียวกันยังทำอยู่
- **THEN** `trigger.listed` มี `lastSkip` ที่มี `why: "busy"` และ `at` เป็นเวลาของรอบนั้น

### Requirement: ตื่นเมื่อเงียบครบเวลา
supervisor SHALL เริ่มงานชิ้นถัดไปเมื่อ Agent ไม่มี Turn ของคนกำลังทำ, ไม่มีชิ้นของลิสต์นั้นที่กำลังทำ และ Turn ของคนล่าสุดของ Agent จบมาแล้วไม่น้อยกว่า `quietMinutes` Turn ของคนคือ Turn ที่เริ่มจากข้อความของ Member Turn ที่เริ่มจาก Trigger SHALL ไม่นับทั้งตอนกำลังทำและตอนนับเวลาเงียบ ชิ้นถัดไป SHALL เป็นชิ้น `pending` ตัวแรกจากบนลงล่างตามลำดับที่เซ็น หลัง supervisor เริ่มใหม่ SHALL นับเวลาเงียบจากตอนที่เริ่ม จึงไม่ชดเชยช่วงที่เครื่องปิด `trigger.run` ของลิสต์ `idle` SHALL เริ่มชิ้นถัดไปทันทีเป็นรอบที่มีคนเฝ้าโดยไม่รอเวลาเงียบ งานทุกชิ้น SHALL ผ่านการตรวจกุญแจ Use ถังขยะ และ Budget เหมือนรอบของ Schedule

#### Scenario: เงียบครบแล้วเริ่มงาน
- **WHEN** ไม่มี Turn ของคน และ Turn ของคนล่าสุดจบมาแล้ว 16 นาที โดย `quietMinutes` เป็น 15
- **THEN** supervisor เปิด Task ใหม่ของชิ้นถัดไป และชิ้นนั้นมีสถานะ `working`

#### Scenario: ยังไม่เงียบพอ
- **WHEN** Turn ของคนล่าสุดจบมาแล้ว 5 นาที
- **THEN** ไม่มี Task ใหม่

#### Scenario: รอบของ Schedule ไม่ทำให้ไม่เงียบ
- **WHEN** Turn ของคนล่าสุดจบมาแล้ว 16 นาที และรอบของ Schedule กำลังทำอยู่
- **THEN** supervisor เปิด Task ใหม่ของชิ้นถัดไป

#### Scenario: ข้อความระหว่างทำงาน
- **WHEN** Member ส่งข้อความเข้า Task อื่นระหว่างที่งานชิ้นหนึ่งกำลังทำ
- **THEN** Turn ของ Member เริ่มทันที งานชิ้นนั้นทำต่อจนจบหรือถึงเพดานเวลา และ Turn ของ Member รอเฉพาะตอนจะเขียนตาม workdir-write-lock

## ADDED Requirements

### Requirement: รอบของ Schedule มีเพดานเวลา
Turn ของรอบ Schedule ที่ทำนานถึง 15 นาที ซึ่งเป็นค่าตายตัวของ Runtime เหมือนชิ้นของ Idle Work SHALL จบเหมือนโดน Stop ด้วย `turn.ended` ที่มี `reason: "stopped"` และ `code: "trigger.time_limit"` เพดานนี้ SHALL ใช้กับทุกรอบ ทั้งที่ถึงเวลาเองและที่ Member สั่งรันเลย คนที่รอล็อกที่เขียนจากรอบของ Schedule จึงรอได้ไม่เกิน 15 นาที

#### Scenario: รอบที่ทำนานเกิน
- **WHEN** รอบของ Schedule ทำนานถึง 15 นาที
- **THEN** Turn จบด้วย `code: "trigger.time_limit"` และล็อกที่รอบนั้นถืออยู่ว่าง
