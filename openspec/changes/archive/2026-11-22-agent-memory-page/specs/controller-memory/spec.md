## Purpose

กำหนดหน้า Memory ใน Controller ที่ให้ Owner อ่าน `MEMORY.md` ของ Agent จากมือถือ แบบอ่านอย่างเดียว โดยแสดงข้อความชุดเดียวกับที่ Runtime ใส่ใน prompt และไม่ตีความเนื้อหา

คำศัพท์: **Memory** คือ `MEMORY.md` ที่ root ของ Workdir (ADR 0036); **`text`** คือข้อความที่ Turn ถัดไปได้รับหลังตัดเพดาน; **`chars`** คือจำนวนตัวอักษรของไฟล์ทั้งหมด; **คำตอบเก่า** คือ `memory.got` ที่ `request` ไม่ตรงกับคำขอล่าสุด

## ADDED Requirements

### Requirement: หน้า Memory ของ Agent อ่านอย่างเดียว

Controller SHALL มีหน้าที่เข้าจากแถว Memory ในหน้า Agent และแสดง `text` ของ Agent นั้นพร้อมจำนวนตัวอักษรเทียบเพดาน 4,000 และเวลาที่ได้ล่าสุด หน้า SHALL มีปุ่มโหลดใหม่ และ MUST NOT มีทางแก้ไขหรือบันทึก `MEMORY.md` ใน v0.1

#### Scenario: เปิดจากหน้า Agent
- **WHEN** Owner เปิดหน้า Agent แล้วกดแถว Memory
- **THEN** Controller ขอ `memory.get` และแสดงเนื้อหา จำนวนตัวอักษร และเวลาที่ได้ล่าสุด

#### Scenario: โหลดใหม่หลังไฟล์เปลี่ยน
- **WHEN** Owner กดโหลดใหม่หลัง Agent เขียน `MEMORY.md`
- **THEN** หน้าแสดงเนื้อหาใหม่ และคำตอบเก่าที่มาช้ากว่าไม่ทับคำตอบใหม่

#### Scenario: ยังไม่มีไฟล์
- **WHEN** Machine ตอบ `memory.got` ที่ `exists` เป็นเท็จ
- **THEN** หน้าแสดงสถานะว่างที่บอกว่ายังไม่มี Memory ไม่ใช่ error

### Requirement: แสดง Memory เป็นข้อความล้วน

Controller MUST แสดง `text` เป็นข้อความล้วน และ MUST NOT ตีความ Markdown, HTML หรือสร้างลิงก์ที่กดได้จากเนื้อหา Memory

#### Scenario: เนื้อหาที่ดูเหมือนโค้ด
- **WHEN** `MEMORY.md` มี `<script>` หรือเครื่องหมาย Markdown
- **THEN** หน้าจอแสดงข้อความเหล่านั้นตามตัวอักษร และไม่รันหรือตีความ

### Requirement: สถานะออฟไลน์และคำตอบเก่า

เมื่อ Machine ออฟไลน์หรือยังไม่ตอบ Controller SHALL แสดง note ที่บอกสถานะ และ MUST NOT แสดงเนื้อหาของ Agent อื่นหรือคำตอบเก่าปนเป็นของปัจจุบัน Controller SHALL ทิ้ง `memory.got` ที่ `request` ไม่ตรงกับคำขอล่าสุด และ SHALL ทิ้งคำตอบที่ `agent` ไม่ตรงกับ Agent ที่ขอ

#### Scenario: เปิดตอน Machine ออฟไลน์
- **WHEN** Owner เปิดหน้า Memory ขณะ Machine ออฟไลน์
- **THEN** หน้าแสดง note ว่าต้องออนไลน์ และไม่มีเนื้อหาเก่าถูกแสดงเป็นของปัจจุบัน

#### Scenario: คำตอบมาช้า
- **WHEN** คำขอเก่าและคำขอใหม่ของ Agent เดียวกันถูกตอบกลับสลับลำดับ
- **THEN** Controller แสดงเฉพาะคำตอบของคำขอล่าสุด

#### Scenario: คำตอบของ Agent อื่น
- **WHEN** ได้ `memory.got` ที่ `agent` ไม่ตรงกับ Agent ที่หน้าขอ
- **THEN** Controller ทิ้งคำตอบนั้นและไม่แสดงเป็นเนื้อหาของ Agent นี้
