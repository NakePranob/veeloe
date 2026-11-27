## ADDED Requirements

### Requirement: หน้า Idle Work ในหน้า Agent
หน้า Agent SHALL มีแถว Idle Work ที่เปิดหน้า Idle Work ของ Agent นั้น หน้า Idle Work SHALL แสดงงานทุกชิ้นตามลำดับ แต่ละชิ้นมีข้อความ จุดสีตามสถานะ (`pending`, `working`, `done`, `timedOut`, `needsApproval`) และเวลาที่รันล่าสุด กดชิ้นที่มี Task SHALL เปิด Task ล่าสุดของชิ้นนั้น หน้า SHALL บอกเวลาเงียบก่อนตื่น เพดานเวลาต่อชิ้น และมีสวิตช์พักหรือทำต่อ หน้า SHALL มีสถานะกำลังโหลด ว่าง error และ Machine ออฟไลน์ คำทั้งหมด SHALL มีทั้งไทยและอังกฤษ

#### Scenario: ยังไม่มีลิสต์
- **WHEN** Agent ยังไม่มีลิสต์ `idle` และไม่มีร่าง
- **THEN** หน้าแสดงสถานะว่างพร้อมปุ่มสร้างลิสต์

#### Scenario: ชิ้นที่ต้องการ Approval
- **WHEN** ชิ้นหนึ่งมีสถานะ `needsApproval`
- **THEN** แถวของชิ้นนั้นมีจุดสีส้ม และกดแล้วเปิด Task ที่มีการ์ดของสิ่งที่ถูกปฏิเสธ

### Requirement: แก้และเซ็นลิสต์ใน sheet
ปุ่มสร้างหรือแก้ SHALL เปิด sheet ที่แก้ข้อความของแต่ละชิ้น เพิ่ม ลบ เรียง ตั้ง `repeat` เลือก `order` เวลาเงียบและเพดานเวลาจากตัวเลือก แล้วบันทึกด้วย `trigger.set` หลังยืนยันตัว (ADR 0012) การบันทึก SHALL ใช้ scope ตามที่ Machine ถืออยู่ตอนบันทึก

#### Scenario: บันทึกลิสต์
- **WHEN** Member เพิ่มสองชิ้น เลือก `oldest-first` แล้วกดบันทึก
- **THEN** Controller ส่ง `trigger.set` ชนิด `idle` ที่มีสองชิ้นนั้น และหน้าแสดงลิสต์ใหม่หลังได้ `trigger.listed`

### Requirement: ร่างจาก Agent
เมื่อ `trigger.listed` มี `draft` หน้า Idle Work SHALL แสดงร่างเหนือลิสต์ พร้อมปุ่มเพิ่มเข้าลิสต์ซึ่งเปิด sheet แก้ที่ต่อร่างไว้ท้ายลิสต์ให้ Member อ่านและแก้ก่อนเซ็น ร่าง SHALL ไม่ถูกส่งไปรันจนกว่า Member จะบันทึก

#### Scenario: เพิ่มร่างเข้าลิสต์
- **WHEN** Agent เสนอสองเรื่อง แล้ว Member กดเพิ่มเข้าลิสต์และบันทึก
- **THEN** ลิสต์ที่เซ็นมีสองเรื่องนั้นต่อท้าย และร่างหายไป
