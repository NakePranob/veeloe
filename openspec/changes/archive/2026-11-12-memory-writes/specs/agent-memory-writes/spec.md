## ADDED Requirements

### Requirement: Agent เขียน Memory ผ่าน tool ที่ Runtime คุมที่อยู่

Runtime SHALL ให้ worker มี tool `memory` ที่รับ `text`, `mode` (`append` หรือ `replace`, ค่าเริ่มต้น `append`) และ `scope` (`long` หรือ `today`, ค่าเริ่มต้น `long`) โดย `long` เขียน `MEMORY.md` ที่ root ของ Workdir และ `today` เขียน `memory/<YYYY-MM-DD>.md` ตามวันที่ของ Machine; การเขียน SHALL เป็นแบบ atomic; `long` MUST ไม่ทำให้ไฟล์เกิน 4,000 ตัวอักษร และเมื่อเกิน MUST ตอบ error `memory.too_long` โดยไม่เปลี่ยนไฟล์

#### Scenario: จดสิ่งถาวร
- **WHEN** Agent เรียก tool `memory` ด้วย `{ text: "เจ้าของชื่อเน็ก", scope: "long" }`
- **THEN** `MEMORY.md` มีบรรทัดนั้นต่อท้าย และ Turn ถัดไปเห็นใน prompt

#### Scenario: เกินเพดาน
- **WHEN** การ append ทำให้ `MEMORY.md` ยาวเกิน 4,000 ตัวอักษร
- **THEN** tool ตอบ `memory.too_long` พร้อมจำนวนปัจจุบัน และไฟล์ไม่เปลี่ยน

#### Scenario: จดเฉพาะวันนี้
- **WHEN** Agent เรียก tool `memory` ด้วย `scope: "today"`
- **THEN** เกิด `memory/<YYYY-MM-DD>.md` และ `MEMORY.md` ไม่เปลี่ยน

#### Scenario: เขียนทับ
- **WHEN** Agent เรียก tool `memory` ด้วย `mode: "replace"`
- **THEN** เนื้อหาเดิมถูกแทนที่ทั้งไฟล์ และยังถูกบังคับเพดาน 4,000 ตัวอักษร

### Requirement: Flush ก่อน compaction

เมื่อ Runtime กำลังจะย่อ context ตาม ADR 0041 Runtime SHALL รัน turn เงียบหนึ่งครั้งที่ขอให้โมเดลตอบเฉพาะสิ่งที่ควรจดถาวร หรือ `NO_REPLY`; ถ้าได้ข้อความ Runtime MUST เป็นผู้เขียนลง `MEMORY.md` ผ่านตัวเขียนเดียวกับ tool และ SHALL บันทึก event `memory.saved` ที่มีจำนวนตัวอักษรโดยไม่มีเนื้อหา; ถ้าได้ `NO_REPLY`, ข้อความว่าง, error หรือ timeout Runtime MUST ข้าม flush และทำ compaction ต่อโดยไม่ทำให้ Turn ล้มเหลว

#### Scenario: มีสิ่งที่ควรจด
- **WHEN** context ถึงเกณฑ์ compaction และโมเดลตอบข้อความที่ควรจด
- **THEN** `MEMORY.md` มีข้อความนั้น, event `memory.saved` ถูกบันทึก และ `context.compacted` ตามมาปกติ

#### Scenario: ไม่มีอะไรต้องจด
- **WHEN** โมเดลตอบ `NO_REPLY`
- **THEN** ไม่มีไฟล์เปลี่ยนและไม่มี event `memory.saved` แต่ compaction ยังทำงาน

#### Scenario: flush ล้มเหลว
- **WHEN** การเรียกโมเดลหรือการเขียนไฟล์ตอน flush ล้มเหลว
- **THEN** Turn ยังตอบได้และ compaction ยังทำงาน
