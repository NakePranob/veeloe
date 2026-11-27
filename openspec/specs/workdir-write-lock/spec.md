# workdir-write-lock Specification

## Purpose
ล็อกที่เขียนของ Workdir และ `MEMORY.md` ตาม ADR 0080: Turn หลายตัวของ Agent ทำพร้อมกันได้ และรอกันเฉพาะตอนจะเขียน โดยงานของคนได้ก่อนงานพื้นหลัง

## Requirements

### Requirement: Turn ขอล็อก Workdir เมื่อจะเขียน และถือไว้จน Turn จบ
Workdir ของ Agent SHALL มีล็อกที่เขียนหนึ่งตัว Turn SHALL ขอล็อกนี้ก่อนเรียก tool `write` หรือ `edit` และก่อนรันคำสั่ง `bash` ที่ไม่ใช่คำสั่งในตัวตาม ADR 0075 (คำสั่งที่ผ่านได้โดยไม่ต้องอยู่ใน Allowlist) Turn ที่ได้ล็อกแล้ว SHALL ถือไว้จน Turn จบ ไม่คืนระหว่างการเขียนแต่ละครั้ง tool `read`, `glob`, `grep`, `send_file`, `web_fetch` และคำสั่งในตัว SHALL ไม่ขอล็อก Turn ที่ถือล็อกแล้วรอ Approval SHALL ยังถือล็อกไว้จนได้คำตอบหรือหมดอายุ การขอล็อกเกิดหลังการตรวจ Allowlist และ Approval ของคำสั่งนั้น คำสั่งที่ถูกปฏิเสธจึงไม่ทำให้ Turn ได้ล็อก

#### Scenario: Turn ที่สองอ่านได้ระหว่างที่อีก Turn เขียน
- **WHEN** Turn ของ Task A ถือล็อกอยู่ และ Turn ของ Task B เรียก `read` กับ `grep`
- **THEN** Turn ของ Task B ได้ผลทันทีโดยไม่รอ Task A

#### Scenario: Turn ที่สองรอตอนจะเขียน
- **WHEN** Turn ของ Task A ถือล็อกอยู่ และ Turn ของ Task B เรียก `write`
- **THEN** `write` ของ Task B รอจน Turn ของ Task A จบ แล้วจึงเขียน

#### Scenario: คำสั่งในตัวไม่รอ
- **WHEN** Turn ของ Task A ถือล็อกอยู่ และ Turn ของ Task B รัน `ls`
- **THEN** คำสั่งนั้นรันทันที

#### Scenario: ถือไว้จนจบ Turn
- **WHEN** Turn หนึ่งเขียนไฟล์สองครั้งโดยมีการเรียก LLM คั่น
- **THEN** ไม่มี Turn อื่นได้ล็อกระหว่างการเขียนสองครั้งนั้น

### Requirement: งานของคนได้ล็อกก่อนงานพื้นหลัง
เมื่อล็อกว่าง Turn ที่รออยู่ซึ่งเริ่มจากข้อความของ Member SHALL ได้ล็อกก่อน Turn ที่เริ่มจาก Trigger (Schedule, Idle Work) Turn ในกลุ่มเดียวกัน SHALL ได้ตามลำดับที่ขอ งานพื้นหลังที่ถือล็อกอยู่ SHALL ไม่ถูกขัดเพราะมีคนรอ

#### Scenario: คนแซงคิวงานพื้นหลัง
- **WHEN** ล็อกถูกถืออยู่ แล้วรอบของ Schedule ขอล็อกก่อน จากนั้น Turn ของ Member ขอล็อก
- **THEN** เมื่อล็อกว่าง Turn ของ Member ได้ล็อกก่อนรอบของ Schedule

#### Scenario: งานพื้นหลังไม่ถูกขัด
- **WHEN** ชิ้นของ Idle Work ถือล็อกอยู่ และ Turn ของ Member ขอล็อก
- **THEN** ชิ้นนั้นทำต่อจนจบหรือถึงเพดานเวลา แล้ว Turn ของ Member จึงได้ล็อก

### Requirement: `MEMORY.md` มีล็อกของตัวเอง
tool `memory` SHALL เขียน `MEMORY.md` และบันทึกรายวันผ่านล็อกเล็กของ Memory ที่แยกจากล็อกของ Workdir และ SHALL ถือไว้เฉพาะระหว่างการเขียนครั้งนั้น การเขียน Memory SHALL ไม่ทำให้ Turn ได้หรือรอล็อกของ Workdir

#### Scenario: สอง Turn จด Memory พร้อมกัน
- **WHEN** Turn สองตัวเรียก `memory` เพื่อต่อท้ายพร้อมกัน
- **THEN** `MEMORY.md` มีทั้งสองบรรทัดครบ ไม่มีบรรทัดไหนหาย

#### Scenario: จด Memory ระหว่างที่อีก Turn ถือล็อก Workdir
- **WHEN** Turn ของ Task A ถือล็อก Workdir และ Turn ของ Task B เรียก `memory`
- **THEN** Task B จด Memory ได้ทันทีโดยไม่รอ Task A

### Requirement: การรอล็อกไม่นับเป็น Turn ค้าง และ Stop ได้
ช่วงที่ Turn รอล็อก SHALL ไม่นับเป็นความเงียบของ Turn ค้าง (ADR 0073) เหมือนช่วงรอ Approval Stop ของ Task ที่ Turn กำลังรอล็อก SHALL จบ Turn นั้นด้วย `turn.stopped` และ `turn.ended` ที่มีเหตุผล `stopped` โดยไม่ได้ล็อก Turn ที่ถือล็อกแล้วจบด้วยเหตุใดก็ตาม รวมถึง Stop เพดานเวลา error หรือ worker ปิด SHALL คืนล็อก

#### Scenario: รอนานไม่ค้าง
- **WHEN** Turn หนึ่งรอล็อกนานเกินห้านาที
- **THEN** ไม่มี `turn.stalled` ของ Turn นั้นจากช่วงที่รอ

#### Scenario: หยุด Turn ที่รอล็อก
- **WHEN** Turn ของ Task B รอล็อกอยู่ แล้ว Owner กดหยุด Task B
- **THEN** Turn ของ Task B จบด้วย `stopped` ทันที และ Turn ของ Task A ที่ถือล็อกทำต่อ

#### Scenario: Turn ที่ถือล็อกล้มเหลว
- **WHEN** Turn ที่ถือล็อกจบเพราะ Provider ล้มเหลว
- **THEN** Turn ถัดไปที่รออยู่ได้ล็อก
