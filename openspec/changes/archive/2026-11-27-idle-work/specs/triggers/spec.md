## ADDED Requirements

### Requirement: ลิสต์ Idle Work
Protocol SHALL รับ Trigger `kind: "idle"` ที่มี `idle` ประกอบด้วย `items` (1 ถึง 50 ชิ้น แต่ละชิ้นมี `id` และ `text` และ `repeat` ที่ไม่บังคับ), `order` เป็น `ordered` หรือ `oldest-first`, `quietMinutes` (5 ถึง 1440, ค่าเริ่มต้น 15) และ `itemMinutes` (1 ถึง 120, ค่าเริ่มต้น 15) Trigger ชนิด `idle` SHALL ไม่มี `schedule` ทั้งสองฝั่งของ Protocol SHALL ตัดสินซองเดียวกันตรงกันตาม vectors Agent หนึ่งตัว SHALL มีลิสต์ `idle` ได้อันเดียว `trigger.set` ของ `idle` SHALL แทนลิสต์เดิมของ Agent นั้น และเก็บสถานะของชิ้นที่ `id` เดิมยังอยู่

#### Scenario: ลิสต์ใหม่แทนอันเดิม
- **WHEN** Agent มีลิสต์ `idle` อยู่แล้ว และ Member ส่ง `trigger.set` ของ `idle` อีกอัน
- **THEN** Agent มีลิสต์ `idle` อันเดียวคืออันใหม่ และชิ้นที่ `id` ตรงกับอันเดิมยังมีสถานะเดิม

#### Scenario: ลิสต์ว่าง
- **WHEN** `items` ว่าง หรือ `order` ไม่ใช่ค่าที่รู้จัก
- **THEN** ซองไม่ผ่านการตรวจทั้งสองฝั่ง

### Requirement: ตื่นเมื่อเงียบครบเวลา
supervisor SHALL เริ่มงานชิ้นถัดไปเมื่อ Agent ไม่มี Turn กำลังทำ, ไม่มีชิ้นของลิสต์นั้นที่กำลังทำ และ Turn ล่าสุดของ Agent จบมาแล้วไม่น้อยกว่า `quietMinutes` ชิ้นถัดไป SHALL เป็นชิ้น `pending` ตัวแรกในลิสต์เมื่อ `order` เป็น `ordered` และชิ้น `pending` ที่รันล่าสุดนานที่สุด (ชิ้นที่ไม่เคยรันมาก่อน) เมื่อเป็น `oldest-first` หลัง supervisor เริ่มใหม่ SHALL นับเวลาเงียบจากตอนที่เริ่ม จึงไม่ชดเชยช่วงที่เครื่องปิด `trigger.run` ของลิสต์ `idle` SHALL เริ่มชิ้นถัดไปทันทีเป็นรอบที่มีคนเฝ้าโดยไม่รอเวลาเงียบ งานทุกชิ้น SHALL ผ่านการตรวจกุญแจ Use ถังขยะ และ Budget เหมือนรอบของ Schedule

#### Scenario: เงียบครบแล้วเริ่มงาน
- **WHEN** ไม่มี Turn และ Turn ล่าสุดจบมาแล้ว 16 นาที โดย `quietMinutes` เป็น 15
- **THEN** supervisor เปิด Task ใหม่ของชิ้นถัดไป และชิ้นนั้นมีสถานะ `working`

#### Scenario: ยังไม่เงียบพอ
- **WHEN** Turn ล่าสุดจบมาแล้ว 5 นาที
- **THEN** ไม่มี Task ใหม่

#### Scenario: ข้อความระหว่างทำงาน
- **WHEN** Member ส่งข้อความถึง Agent ระหว่างที่งานชิ้นหนึ่งกำลังทำ
- **THEN** ข้อความต่อคิว และงานชิ้นนั้นทำต่อจนจบ

### Requirement: เพดานเวลาและสถานะต่อชิ้น
รอบของ Idle Work SHALL เป็นรอบที่ไม่มีคนเฝ้าตามกติกาของ scope (ADR 0079) Turn ของงานชิ้นหนึ่งที่ทำนานถึง `itemMinutes` SHALL จบเหมือนโดน Stop ด้วย `turn.ended` ที่มี `reason: "stopped"` และ `code: "trigger.time_limit"` เมื่อ Turn ของชิ้นนั้นจบ supervisor SHALL ตั้งสถานะเป็น `needsApproval` ถ้า Task มี `approval.skipped`, `done` ถ้า Turn จบด้วย `reason` เป็น `done` หรือ `quiet`, และ `timedOut` ในกรณีอื่น (เพดานเวลา ถูก Stop ล้มเหลว หรือถูกขัดเพราะ Runtime เริ่มใหม่) ชิ้น `done` ที่มี `repeat` SHALL กลับเป็น `pending` ส่วนชิ้น `done` อื่น SHALL ไม่อยู่ในลิสต์ที่ `trigger.listed` ส่ง `trigger.listed` SHALL ส่งสถานะ เวลาที่รันล่าสุด และ Task ล่าสุดของแต่ละชิ้น

#### Scenario: ถึงเพดานเวลา
- **WHEN** งานชิ้นหนึ่งทำนานถึง `itemMinutes`
- **THEN** Turn จบด้วย `code: "trigger.time_limit"` และชิ้นนั้นมีสถานะ `timedOut`

#### Scenario: ต้องใช้สิ่งนอก scope
- **WHEN** งานชิ้นหนึ่งเรียกคำสั่งที่อยู่นอก Allowlist และ scope
- **THEN** คำสั่งถูกปฏิเสธทันที และหลัง Turn จบ ชิ้นนั้นมีสถานะ `needsApproval`

#### Scenario: งานที่วนกลับ
- **WHEN** ชิ้นที่มี `repeat` ทำเสร็จ
- **THEN** ชิ้นนั้นกลับเป็น `pending` และเวลาที่รันล่าสุดเป็นตอนนั้น

### Requirement: Agent เสนอเรื่องเข้าร่าง
ทุก Turn SHALL มี tool `propose_idle_work` ที่รับรายการข้อความ 1 ถึง 10 ชิ้น supervisor SHALL ต่อท้ายข้อความเหล่านั้นในร่างของ Agent นั้น (สูงสุด 50 ชิ้น) และส่งร่างใน `trigger.listed` เป็น `draft` ร่าง SHALL ไม่ถูกรันจนกว่า Member จะเซ็นลิสต์ที่มีเรื่องนั้น และการเซ็นลิสต์ `idle` ใหม่ SHALL ล้างร่าง

#### Scenario: Agent เสนอ
- **WHEN** Agent เรียก `propose_idle_work` ด้วย "เขียน test ของ parser"
- **THEN** `trigger.listed` ของ Agent นั้นมี `draft` ที่มีข้อความนั้น และไม่มี Task ใหม่

### Requirement: เพดานงานพื้นหลัง
Idle Work และ Watch SHALL ใช้ token รวมกันต่อวันได้ไม่เกิน `backgroundShare` เปอร์เซ็นต์ของ Budget ของ Agent (ค่าเริ่มต้น 30) `usage` SHALL แยกที่มาเป็น `idle` เมื่อถึงเพดาน supervisor SHALL ไม่เริ่มชิ้นใหม่ และ SHALL หยุด Turn ของ Idle Work ที่กำลังทำ ส่วน Turn ของคนทำต่อได้ Agent ที่ไม่มี Budget SHALL ไม่มีเพดานนี้

#### Scenario: ถึงเพดาน 30%
- **WHEN** Budget ของ Agent เป็น 1,000,000 และวันนี้ Idle Work ใช้ไปแล้ว 300,000 token
- **THEN** ไม่มีงานชิ้นใหม่เริ่ม และ Member ยังส่งงานให้ Agent ได้ตามปกติ
