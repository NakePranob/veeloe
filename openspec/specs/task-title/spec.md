# task-title Specification

## Purpose

กำหนดว่า Task ได้ชื่ออย่างไร ชื่อเก็บไว้ที่ไหน และ Controller แสดงชื่อนั้นอย่างไร เพื่อให้ Owner รู้ได้จากรายการว่าแต่ละ Task คุยเรื่องอะไร โดยไม่ต้องกดเข้าไปอ่าน

## Requirements

### Requirement: Runtime ตั้งชื่อ Task หลัง Turn แรก
เมื่อ Turn ที่จบด้วยเหตุผล `done` เป็นตัวแรกของ Task ที่จบแบบนั้น harness SHALL ขอชื่อจาก LLM ของ Task นั้นหนึ่งครั้ง โดยไม่มี tool และส่งให้แค่ข้อความแรกของ Member ใน Task กับข้อความสุดท้ายของ Agent ใน Turn นั้น harness SHALL บันทึกชื่อเป็น event `task.titled` ที่มี `title` ใน log ของ Task นั้น ชื่อ SHALL เป็นบรรทัดเดียว ไม่เกิน 60 ตัวอักษร และใช้ภาษาเดียวกับข้อความของ Member การตั้งชื่อ MUST NOT ทำให้คำตอบของ Turn ช้าลง และ MUST NOT ทำให้ Turn ใดจบด้วย error เมื่อ Provider ล้มเหลว Budget หมด worker เริ่มใหม่ระหว่างรอ หรือได้คำตอบว่าง Task SHALL ไม่มีชื่อ และ harness SHALL NOT ลองใหม่ใน Turn ถัดไป token ที่ใช้ตั้งชื่อ SHALL นับเข้า Budget ของ Agent และนับเป็นของ Task นั้น

#### Scenario: Turn แรกจบปกติ
- **WHEN** Owner เริ่ม Task ใหม่ด้วยข้อความ "ช่วยดูว่าทำไม build บน CI แดง" และ Turn แรกจบด้วย `done`
- **THEN** log ของ Task มี `task.titled` ต่อจาก `turn.ended` ที่มี `title` เป็นภาษาไทย บรรทัดเดียว และไม่เกิน 60 ตัวอักษร

#### Scenario: Turn แรกไม่จบแบบ done
- **WHEN** Turn แรกจบด้วย `stopped`, `error` หรือ `interrupted`
- **THEN** log ไม่มี `task.titled` และ Turn ถัดไปที่จบด้วย `done` เป็นตัวที่ตั้งชื่อ

#### Scenario: ตั้งชื่อไม่สำเร็จ
- **WHEN** Provider ตอบ error ระหว่างขอชื่อ
- **THEN** log ไม่มี `task.titled` Turn ที่จบไปแล้วยังเป็น `done` และ Turn ต่อ ๆ มาไม่ขอชื่ออีก

#### Scenario: มีชื่อแล้ว
- **WHEN** Turn ที่จบด้วย `done` ของ Task ที่มี `task.titled` แล้ว ไม่ว่าจะมาจาก Runtime หรือ Member
- **THEN** harness ไม่ขอชื่อใหม่

### Requirement: หน้า Agent แสดงชื่อ Task
แถวของแต่ละ Task ในหน้า Agent SHALL ใช้ `title` ของ `task.titled` ล่าสุดเป็นชื่อแถว เมื่อยังไม่มี SHALL ใช้บรรทัดแรกของข้อความแรกของ Member และเมื่อยังไม่มีข้อความเลย SHALL ใช้คำว่ายังไม่มีข้อความ ชื่อแถว MUST NOT เปลี่ยนเพราะมีข้อความใหม่ใน Task `task.titled` MUST NOT เปลี่ยนสถานะของ Task, Mood ของ Character หรือสิ่งที่แถวใน Inbox แสดง และหน้า Task MUST NOT แสดง `task.titled` เป็นบรรทัดใน log

#### Scenario: Task ที่มีชื่อแล้ว
- **WHEN** Task มี `task.titled` แล้ว และ Agent ตอบข้อความใหม่
- **THEN** แถวในหน้า Agent ยังแสดงชื่อจาก `task.titled` ไม่ใช่ข้อความล่าสุด

#### Scenario: Task ที่ยังไม่มีชื่อ
- **WHEN** Turn แรกของ Task ยังไม่จบ
- **THEN** แถวในหน้า Agent แสดงบรรทัดแรกของข้อความแรกของ Owner

#### Scenario: สถานะหลังได้ชื่อ
- **WHEN** event ล่าสุดของ Task คือ `task.titled` ที่ต่อจาก `turn.ended` ที่เป็น `done`
- **THEN** สถานะของ Task ยังเป็น done และ Character ไม่เปลี่ยน Mood

### Requirement: หัวหน้า Task แสดงชื่อ Task
หัวของหน้า Task ที่เริ่มแล้วของ Agent ที่ยังอยู่ SHALL วาง Character ของ Agent ไว้ติดปุ่มกลับทางซ้าย ตามด้วยชื่อ Agent และใต้ชื่อ Agent SHALL เป็นชื่อ Task ตามกติกาเดียวกับแถวในหน้า Agent (ชื่อจาก `task.titled` ล่าสุด หรือบรรทัดแรกของข้อความแรก) แทนสถานะ เมื่อ Task ไม่มีทั้งสองอย่าง SHALL แสดงสถานะตามเดิม Task ใหม่ที่ยังไม่มีข้อความ และ Task ของ Agent ที่ถูกลบ SHALL คงหัวตรงกลางแบบเดิม ชื่อที่ยาวเกินที่ว่าง SHALL ตัดท้ายเป็นบรรทัดเดียว

#### Scenario: Task ที่มีชื่อแล้ว
- **WHEN** Owner เปิด Task ที่มี `task.titled` "Understanding git rebase"
- **THEN** หัวหน้าแสดง Character ติดปุ่มกลับ ชื่อ Agent และ "Understanding git rebase" ใต้ชื่อ Agent

#### Scenario: Task ใหม่
- **WHEN** Owner กด Task ใหม่และยังไม่ได้ส่งข้อความ
- **THEN** หัวหน้ายังเป็นหัวตรงกลางของ Task ใหม่แบบเดิม

### Requirement: Member แก้ชื่อ Task ได้
Member ที่เริ่ม Task SHALL แก้ชื่อ Task ได้ที่ชื่อบนแผ่นรายละเอียด Task โดยแตะชื่อแล้วแก้ในที่ และบันทึกเมื่อกด Return หรือออกจากช่อง Controller SHALL ส่งคำสั่งที่เซ็นแล้ว `task.rename` ที่มี `agent` กับ `title` (บรรทัดเดียว 1 ถึง 60 ตัวอักษร) worker SHALL ตรวจว่าผู้ส่งเป็นคนเริ่ม Task แล้ว append `task.titled` ที่มี `title` กับ `member` ใน log ส่วนผู้ส่งที่ไม่ใช่คนเริ่ม หรือ Task ที่ไม่มีอยู่ SHALL ได้ `task.not_found` ชื่อที่ Member ตั้ง SHALL เป็นชื่อของ Task จนกว่าจะแก้อีก และ Runtime MUST NOT ตั้งชื่อทับเมื่อ Task มี `task.titled` อยู่แล้ว ชื่อ SHALL แก้ไม่ได้เมื่อ Machine ออฟไลน์ และชื่อใหม่แสดงเมื่อ event กลับมาถึงเครื่อง

#### Scenario: แก้ชื่อจากหัวหน้า Task
- **WHEN** Owner เปิดแผ่นรายละเอียด แตะชื่อ แล้วพิมพ์ "ทบทวน git" และกด Return
- **THEN** log มี `task.titled` ที่มี `title` เป็น "ทบทวน git" และ `member` ของ Owner และทั้งหัวหน้า Task และแถวในหน้า Agent แสดง "ทบทวน git"

#### Scenario: แก้ชื่อก่อน Runtime ตั้งให้
- **WHEN** Owner แก้ชื่อระหว่างที่ Turn แรกยังไม่จบ แล้ว Turn นั้นจบด้วย `done`
- **THEN** Runtime ไม่ตั้งชื่อทับ และชื่อยังเป็นชื่อที่ Owner ตั้ง

#### Scenario: ไม่ใช่คนเริ่ม Task
- **WHEN** Member ที่ไม่ได้เริ่ม Task ส่ง `task.rename`
- **THEN** ได้ `task.not_found` และ log ไม่เปลี่ยน

### Requirement: แผ่นรายละเอียด Task
การกดค้างแถวของ Task ในหน้า Agent และการแตะหัวหน้า Task SHALL เปิดแผ่นรายละเอียดของ Task นั้นเป็น sheet ที่ไม่มีแถบหัว แผ่นนี้ SHALL แสดง Character ชื่อ Task สถานะ ส่วน Context รายละเอียด (Agent, Machine, เวลาเริ่ม, เวลาเคลื่อนไหวล่าสุด, จำนวน Turn) ไฟล์ที่ Agent แก้ด้วย edit และ write และไฟล์ที่ Agent ส่งมา เมื่อ Turn กำลังทำงาน SHALL มีปุ่มหยุด Turn ที่ถามยืนยันแบบเดียวกับช่องพิมพ์ เมื่อเปิดจากหน้า Agent SHALL มีปุ่มเปิด Task และทุกครั้ง SHALL มีปุ่มไปหน้า Agent เมื่อ Machine ออฟไลน์ SHALL บอกว่าข้อมูลเป็นของล่าสุดบนเครื่อง

#### Scenario: เปิดจากหน้า Agent
- **WHEN** Owner กดค้างแถว Task ในหน้า Agent
- **THEN** แผ่นรายละเอียดของ Task นั้นเปิดขึ้น และมีปุ่มเปิด Task

#### Scenario: Turn กำลังทำงาน
- **WHEN** Owner แตะหัวหน้า Task ระหว่างที่ Turn ทำงาน
- **THEN** แผ่นรายละเอียดมีปุ่มหยุด Turn นี้

### Requirement: Context แยกส่วน
ทุก `context.usage` ที่ harness เขียน SHALL มี `parts` ที่บอกน้ำหนักของแต่ละส่วนของคำขอ คือ `system` (คำสั่งของระบบ), `memory` (MEMORY.md), `tools` (คำอธิบาย tool), `summary` (สรุปจากการย่อ), `you` (ข้อความของ Member), `agent` (คำตอบและคำสั่งที่ Agent เรียก) และ `results` (ผลจาก tool) นับคร่าว ๆ แบบเดียวกับ `tokens` (ADR 0041) และละส่วนที่เป็นศูนย์ `tokens` SHALL เป็นค่าเดิมที่การย่อ context ใช้ แผ่นรายละเอียด SHALL แสดงยอดรวมของ `parts` เทียบกับ `window` แถบที่แบ่งตามส่วนพร้อมเส้นที่ 70% และรายการของแต่ละส่วนพร้อม token และเปอร์เซ็นต์ของ `window` รวมถึงส่วนที่ยังว่าง เมื่อ `context.usage` ล่าสุดไม่มี `parts` SHALL บอกว่ายังไม่มีตัวเลขแยกส่วน

#### Scenario: Turn ที่มีผลจาก tool
- **WHEN** Turn เรียก tool แล้ว harness เขียน `context.usage` ก่อนคำขอถัดไป
- **THEN** `parts` มี `results` และ `system` และ `tools` และไม่มีส่วนที่เป็นศูนย์

#### Scenario: Runtime รุ่นเก่า
- **WHEN** `context.usage` ล่าสุดของ Task ไม่มี `parts`
- **THEN** ส่วน Context ในแผ่นรายละเอียดบอกว่ายังไม่มีตัวเลขแยกส่วน
