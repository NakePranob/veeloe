# runtime-logs Specification

## Purpose
กำหนด log ที่ไม่มีเนื้อหาของ Runtime, การหมุนไฟล์รายวัน 14 วัน, คำสั่ง `veeloe logs` และสถานะ Machine ที่ Controller แสดง

คำศัพท์: **Log line** คือ JSON หนึ่งบรรทัด; **Content-free** คือไม่มีข้อความแชต/ผล tool/ชื่อไฟล์/ความลับ; **Machine status** คือ version, features, last error, disk free และ Budget วันนี้

## Requirements

### Requirement: Runtime เขียน log ที่ไม่มีเนื้อหาและหมุนรายวัน
Runtime SHALL เขียน log เป็น JSON lines ใต้ `<VEELOE_HOME>/runtime/logs/` โดยแยกไฟล์ตามวันและเก็บ 14 วัน; log line MUST มีเฉพาะระดับ, รหัสเหตุการณ์, id ของ Agent/Task/Turn, ชื่อ tool, ระยะเวลา, token และ error code; MUST NOT มีข้อความแชต ผล tool ชื่อไฟล์ Workdir หรือความลับ

#### Scenario: เขียน log
- **WHEN** Runtime เริ่มหรือเกิด error
- **THEN** มี log line ในไฟล์ของวันนั้นที่มีเฉพาะ field ที่อนุญาต

#### Scenario: หมุนไฟล์
- **WHEN** ไฟล์ log เก่ากว่า 14 วัน
- **THEN** Runtime ลบไฟล์นั้นเมื่อเขียน log รอบถัดไป

### Requirement: ดู log บนเครื่อง
`veeloe logs` SHALL พิมพ์ log ล่าสุด และ `veeloe logs --follow` SHALL พิมพ์บรรทัดใหม่ต่อเนื่องจนผู้ใช้หยุด

#### Scenario: ดู log
- **WHEN** ผู้ใช้รัน `veeloe logs`
- **THEN** เห็น log lines จากไฟล์ล่าสุดเรียงตามเวลา

#### Scenario: follow
- **WHEN** ผู้ใช้รัน `veeloe logs --follow` แล้วมี log ใหม่
- **THEN** บรรทัดใหม่ปรากฏจนกด Ctrl-C

### Requirement: Controller แสดงสถานะ Machine
Controller SHALL ขอ `machine.status` เมื่อเปิดหน้า Machine; Runtime SHALL ตอบด้วย version, features, last error, disk free และ Budget วันนี้; Controller SHALL แสดงค่าเหล่านี้ในหน้า Machine

#### Scenario: เปิดหน้า Machine
- **WHEN** Controller เปิดหน้า Machine ที่ Runtime ต่ออยู่
- **THEN** Controller ได้ `machine.status` และแสดงการ์ดสถานะ

#### Scenario: ค่าเปลี่ยน
- **WHEN** last error หรือ disk/budget เปลี่ยนแล้วผู้ใช้เปิดหน้า Machine อีกครั้ง
- **THEN** Controller ขอสถานะใหม่และแสดงค่าล่าสุด
