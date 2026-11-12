## ADDED Requirements

### Requirement: `veeloe memory` แสดง Memory ที่ Turn ถัดไปเห็น

`veeloe memory <agent>` SHALL แสดงชื่อกับ id ของ Agent, ที่อยู่ของ `MEMORY.md` ซึ่งอ้างจากโฟลเดอร์ Runtime, จำนวนตัวอักษรในไฟล์ และเนื้อหาที่ Turn ถัดไปได้รับหลังตัดตามเพดาน 4,000 ตัวอักษร; คำสั่ง SHALL รับ Agent ได้ทั้ง id และชื่อ; ชื่อที่ตรงกับมากกว่าหนึ่ง Agent MUST ถูกปฏิเสธพร้อมบอกให้ใช้ id; Agent ที่อยู่ในถังขยะ SHALL อ่านได้และ MUST ติดว่า `(in the trash)`; Agent ที่ไม่รู้จัก SHALL จบด้วย exit code 2; ไม่มีไฟล์ SHALL บอกว่า prompt ไม่มี Memory และ MUST NOT สร้าง Workdir หรือไฟล์ว่าง

#### Scenario: อ่าน Memory ของ Agent ที่มีไฟล์
- **WHEN** Owner รัน `veeloe memory Pang`
- **THEN** terminal แสดง id ของ Agent, ที่อยู่ไฟล์, จำนวนตัวอักษร และเนื้อหา Memory ที่ Turn ถัดไปเห็น

#### Scenario: ยังไม่มี MEMORY.md
- **WHEN** Owner รัน `veeloe memory` ให้ Agent ที่ยังไม่มีไฟล์
- **THEN** terminal บอกว่า prompt ไม่มี Memory และไม่มีโฟลเดอร์ใหม่ถูกสร้าง

#### Scenario: ชื่อซ้ำกันสอง Agent
- **WHEN** Owner รัน `veeloe memory` ด้วยชื่อที่ตรงกับสอง Agent
- **THEN** terminal ปฏิเสธและบอกให้ระบุ id
