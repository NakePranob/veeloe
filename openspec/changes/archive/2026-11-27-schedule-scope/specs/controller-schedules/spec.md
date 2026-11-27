## ADDED Requirements

### Requirement: รายการ Schedule และ sheet ของแต่ละอัน
หน้า Schedule SHALL แสดง Schedule ละหนึ่งแถว ซึ่งมีข้อความที่สั่ง จังหวะเวลา รอบถัดไปหรือสถานะพัก/ระงับ และจุดสีบอกผลของรอบล่าสุด รอบล่าสุดคืออันที่ใหม่กว่าระหว่าง Task ล่าสุดของเส้นนั้นกับ `lastSkip` และมีผลเป็นหนึ่งใน มีเรื่องบอก, ไม่มีอะไร, กำลังทำ, รอ Approval, ไม่สำเร็จ, ข้ามเพราะ Agent ไม่ว่าง หรือข้ามเพราะ Budget หมด แถวและปุ่มเพิ่ม SHALL เปิด sheet ของ Schedule นั้น ซึ่งแก้ข้อความและเวลาโดยเลือกจากตัวเลือก (ไม่พิมพ์เวลาเอง) เปิดหรือพัก รันเลย เปิด Task ของรอบล่าสุด แสดงรายการใน `allow` ให้เอาออกทีละอัน และลบ Schedule ได้ การบันทึก SHALL ใช้ `allow` ตามที่ Machine ถืออยู่ตอนบันทึก

#### Scenario: รอบล่าสุดถูกข้าม
- **WHEN** `lastSkip` ใหม่กว่า Task ล่าสุดของเส้น และ `why` เป็น `busy`
- **THEN** sheet แสดงว่ารอบนั้นข้ามเพราะ Agent ไม่ว่าง และจุดในแถวเป็นสีส้ม

#### Scenario: เอาออกจาก scope
- **WHEN** Member กดเอา `curl` ออกใน sheet แล้วยืนยันตัว
- **THEN** Controller ส่ง `trigger.set` ที่ `allow` ไม่มี `curl`

### Requirement: เพิ่มเข้า scope จาก Task
Task ของรอบ Schedule ที่มี `approval.skipped` SHALL แสดงสิ่งที่ถูกปฏิเสธ ถ้าเป็นคำสั่งหรือ tool SHALL มีปุ่ม "ให้ Schedule นี้ทำได้เลย" ซึ่งต่อรายการนั้นเข้า `allow` ของ Schedule ด้วย `trigger.set` หลังยืนยันตัว Approval ที่รออยู่ใน Task ของรอบ Schedule SHALL มีตัวเลือกเดียวกันในตัวเลือกอื่นของ Approval ซึ่งอนุมัติครั้งนี้และเพิ่มเข้า scope ในการยืนยันตัวครั้งเดียว ปุ่มนี้ SHALL ไม่แสดงเมื่อ Schedule ถูกลบหรือถูกระงับแล้ว

#### Scenario: เพิ่มคำสั่งที่ถูกปฏิเสธ
- **WHEN** Task ของรอบมี `approval.skipped` ของ `curl -s example.com` แล้ว Member กดปุ่ม
- **THEN** Controller ส่ง `trigger.set` ที่ `allow` มีคำนำหน้า `curl` และรอบถัดไปไม่ถูกปฏิเสธ
