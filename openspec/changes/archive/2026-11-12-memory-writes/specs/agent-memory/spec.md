## ADDED Requirements

### Requirement: Prompt บอกทางเขียน Memory

system prompt ของทุก Turn SHALL บอกว่า Memory อยู่ที่ `MEMORY.md` ที่ root ของ Workdir, ให้เขียนด้วย tool `memory`, ใช้ `scope: "today"` สำหรับ `memory/<วันที่>.md` และ `MEMORY.md` ถูกตรึงเข้า prompt ทุก Turn พร้อมเพดาน 4,000 ตัวอักษร

#### Scenario: Turn แรกที่ยังไม่มีไฟล์
- **WHEN** Agent เริ่ม Turn และยังไม่มี `MEMORY.md`
- **THEN** prompt ยังบอกที่อยู่และ tool ที่ใช้เขียน Memory

#### Scenario: มีไฟล์อยู่แล้ว
- **WHEN** มี `MEMORY.md`
- **THEN** prompt มีคำแนะนำเดียวกับด้านบนตามด้วยเนื้อหาปัจจุบัน
