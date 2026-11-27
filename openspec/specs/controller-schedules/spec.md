# controller-schedules Specification

## Purpose
หน้า Schedule ของ Agent ใน Controller ที่ให้ Member สร้าง แก้ พัก ลบ และรัน Schedule ทันที โดยทุกการเปลี่ยนแปลงเป็นข้อความที่เซ็นแล้วส่งไปยัง Machine

## Requirements

### Requirement: หน้า Schedule ในหน้า Agent
หน้า Agent SHALL มีแถว Schedule ที่บอกจำนวน Schedule ของ Agent และเปิดหน้า Schedule หน้า Schedule SHALL ถาม Machine ด้วย `trigger.list` ทุกครั้งที่เปิด และ SHALL แสดง Schedule แต่ละอันพร้อมข้อความ เวลา สถานะพักหรือระงับ และเวลารอบถัดไปที่ Machine ส่งมา ขณะ Machine ออฟไลน์ SHALL บอกว่าออฟไลน์และปิดปุ่มที่เปลี่ยนค่า

#### Scenario: เปิดหน้า
- **WHEN** Member เปิดหน้า Schedule ของ Agent ที่ Machine ออนไลน์อยู่
- **THEN** Controller ส่ง `trigger.list` และแสดง Schedule ตาม `trigger.listed` พร้อมเวลารอบถัดไป

#### Scenario: Machine ออฟไลน์
- **WHEN** Machine ออฟไลน์
- **THEN** หน้าบอกว่าออฟไลน์ และสร้าง แก้ พัก ลบ หรือรันไม่ได้

### Requirement: สร้างและแก้ Schedule
Member SHALL สร้าง Schedule ได้ด้วยข้อความที่จะสั่งและเวลาแบบใดแบบหนึ่ง คือทุก N นาที (อย่างน้อย 15) ทุกวันตามเวลา หรือทุกสัปดาห์ตามวันและเวลา และ SHALL แก้ Schedule เดิมได้ทั้งอัน Controller SHALL ปฏิเสธค่าที่ Protocol ไม่รับก่อนส่ง และ SHALL ส่ง `trigger.set` หลังยืนยันตัวใหม่ (ADR 0012)

#### Scenario: สร้าง Schedule ทุกวัน
- **WHEN** Member ใส่ข้อความ เลือกทุกวัน 09:00 แล้วบันทึก
- **THEN** Controller ส่ง `trigger.set` ที่เซ็นแล้ว และหน้าแสดง Schedule ใหม่เมื่อ `trigger.listed` กลับมา

#### Scenario: ถี่เกินไป
- **WHEN** Member ใส่ทุก 5 นาที
- **THEN** Controller บอกว่าต้องอย่างน้อย 15 นาทีและไม่ส่งอะไร

#### Scenario: ข้อความว่าง
- **WHEN** Member บันทึกโดยไม่มีข้อความ
- **THEN** ปุ่มบันทึกกดไม่ได้

### Requirement: พัก ลบ และรันทันที
แต่ละ Schedule SHALL มีปุ่มพักหรือกลับมาทำต่อ ลบ และรันทันที การลบ SHALL ถามยืนยันก่อน error จาก Machine SHALL แสดงด้วยคำอธิบายทั้งไทยและอังกฤษ

#### Scenario: รันทันที
- **WHEN** Member กดรันทันที
- **THEN** Controller ส่ง `trigger.run` และ Task ใหม่ของ Schedule นั้นเริ่มบน Machine

#### Scenario: ลบ
- **WHEN** Member กดลบแล้วยืนยัน
- **THEN** Controller ส่ง `trigger.delete` และ Schedule หายจากหน้าเมื่อ `trigger.listed` กลับมา

### Requirement: Inbox ไม่แสดงรอบที่เงียบ
Controller SHALL ไม่แสดง Task ที่ Turn ล่าสุดจบด้วย `reason: "quiet"` ใน Inbox และ SHALL ยังเปิด Task นั้นได้จากหน้า Agent

#### Scenario: รอบที่ไม่มีอะไรบอก
- **WHEN** Task ของ Schedule จบแบบ quiet
- **THEN** Task ไม่ขึ้นใน Inbox แต่ยังอยู่ในรายการ Task ของ Agent

### Requirement: รายการ Schedule และ sheet ของแต่ละอัน
หน้า Schedule SHALL แสดง Schedule ละหนึ่งแถว ซึ่งมีข้อความที่สั่ง จังหวะเวลา รอบถัดไปหรือสถานะพัก/ระงับ และจุดสีบอกผลของรอบล่าสุด รอบล่าสุดคืออันที่ใหม่กว่าระหว่าง Task ล่าสุดของเส้นนั้นกับ `lastSkip` และมีผลเป็นหนึ่งใน มีเรื่องบอก, ไม่มีอะไร, กำลังทำ, รอ Approval, ไม่สำเร็จ, ข้ามเพราะรอบก่อนยังไม่จบ หรือข้ามเพราะ Budget หมด แถวและปุ่มเพิ่ม SHALL เปิด sheet ของ Schedule นั้น ซึ่งแก้ข้อความและเวลาโดยเลือกจากตัวเลือก (ไม่พิมพ์เวลาเอง) เปิดหรือพัก รันเลย เปิด Task ของรอบล่าสุด แสดงรายการใน `allow` ให้เอาออกทีละอัน และลบ Schedule ได้ การบันทึก SHALL ใช้ `allow` ตามที่ Machine ถืออยู่ตอนบันทึก

#### Scenario: รอบล่าสุดถูกข้าม
- **WHEN** `lastSkip` ใหม่กว่า Task ล่าสุดของเส้น และ `why` เป็น `busy`
- **THEN** sheet แสดงว่ารอบนั้นข้ามเพราะรอบก่อนยังไม่จบ และจุดในแถวเป็นสีส้ม

#### Scenario: เอาออกจาก scope
- **WHEN** Member กดเอา `curl` ออกใน sheet แล้วยืนยันตัว
- **THEN** Controller ส่ง `trigger.set` ที่ `allow` ไม่มี `curl`

### Requirement: เพิ่มเข้า scope จาก Task
Task ของรอบ Schedule ที่มี `approval.skipped` SHALL แสดงสิ่งที่ถูกปฏิเสธ ถ้าเป็นคำสั่งหรือ tool SHALL มีปุ่ม "ให้ Schedule นี้ทำได้เลย" ซึ่งต่อรายการนั้นเข้า `allow` ของ Schedule ด้วย `trigger.set` หลังยืนยันตัว Approval ที่รออยู่ใน Task ของรอบ Schedule SHALL มีตัวเลือกเดียวกันในตัวเลือกอื่นของ Approval ซึ่งอนุมัติครั้งนี้และเพิ่มเข้า scope ในการยืนยันตัวครั้งเดียว ปุ่มนี้ SHALL ไม่แสดงเมื่อ Schedule ถูกลบหรือถูกระงับแล้ว

#### Scenario: เพิ่มคำสั่งที่ถูกปฏิเสธ
- **WHEN** Task ของรอบมี `approval.skipped` ของ `curl -s example.com` แล้ว Member กดปุ่ม
- **THEN** Controller ส่ง `trigger.set` ที่ `allow` มีคำนำหน้า `curl` และรอบถัดไปไม่ถูกปฏิเสธ
