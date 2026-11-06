## MODIFIED Requirements

### Requirement: Controller ขอรายชื่อ Agent และ Provider ได้
supervisor SHALL ตอบคำขอรายชื่อที่เซ็นด้วยกุญแจที่ไว้ใจ ด้วยรายชื่อ Agent และรายชื่อ Provider พร้อม model ของแต่ละตัว คำตอบ MUST NOT มี key หรือ URL ของ Provider Agent แต่ละตัวในคำตอบ SHALL มี `budget` และ `usage` ซึ่งมี `day` กับ `tokens` ของวันนี้ เป็น field ที่ไม่บังคับ เพื่อให้ Controller เก่าข้ามได้และ Machine เก่าที่ไม่ส่งก็ไม่ทำให้ Controller ใหม่พัง (ADR 0023)

#### Scenario: ขอรายชื่อ
- **WHEN** Controller ส่งคำขอรายชื่อ
- **THEN** ได้รายชื่อ Agent กับชื่อ Provider และ model ที่เลือกได้ และไม่มี key

#### Scenario: Provider ตอบรายชื่อ model ไม่ได้
- **WHEN** supervisor ถาม model จาก Provider ไม่สำเร็จ
- **THEN** Provider นั้นอยู่ในคำตอบพร้อม error code แทนรายชื่อ model และ Provider ตัวอื่นยังมีรายชื่อครบ

#### Scenario: เปิดแอปหลังวันใหม่
- **WHEN** Controller ขอรายชื่อหลัง 04:00 ก่อน Agent ใช้ token
- **THEN** `usage` ของ Agent มี `day` เป็นวันนี้และ `tokens` เป็น 0 และ `budget` เป็น Budget ของ Agent นั้น

## ADDED Requirements

### Requirement: Machine บอกยอดของวันนี้ระหว่างใช้
หลังทุกคำตอบที่ถูกนับ supervisor SHALL ส่ง `agent.usage` ที่มี `agent`, `day`, `tokens` และ `budget` ถึงทุก Member ใน trust เพื่อให้ Controller ที่ต่ออยู่เห็นยอดล่าสุด Controller ที่ไม่ได้ต่อ SHALL ได้ยอดล่าสุดจาก `agent.listed` ครั้งถัดไป

#### Scenario: ยอดขยับระหว่าง Turn
- **WHEN** LLM ตอบเสร็จหนึ่งครั้ง
- **THEN** Owner ได้ `agent.usage` ที่มียอดรวมคำตอบนั้นแล้ว
