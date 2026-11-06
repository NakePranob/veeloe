## ADDED Requirements

### Requirement: Task บอกว่า Budget หมด
เมื่อ Turn จบด้วย code `budget.exhausted` หน้า Task SHALL แสดงการ์ดในภาษาของ Owner ว่า Budget ของวันนี้หมดแล้ว งานใหม่เริ่มตอน 04:00 ตามเวลาของ Machine หรือเมื่อเพิ่ม Budget และไฟล์ที่แก้ไว้ยังอยู่ พร้อมปุ่มที่เปิดหน้า Agent เพื่อเพิ่ม Budget เมื่อข้อความที่ส่งได้ error `budget.exhausted` ข้อความนั้น SHALL ถูกตั้งเป็นส่งไม่สำเร็จ และใต้ข้อความ SHALL มีคำที่บอกว่า Budget ของวันนี้หมดและเพิ่มได้ที่หน้า Agent การกดส่งข้อความ SHALL ปิดคีย์บอร์ด คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: หมดกลาง Turn
- **WHEN** Turn จบด้วย `budget.exhausted`
- **THEN** Task แสดงคำที่บอกว่า Budget หมดกับปุ่มเพิ่ม Budget และข้อความที่ Agent ตอบไปแล้วยังอยู่

#### Scenario: ส่งข้อความตอน Budget หมด
- **WHEN** Owner ส่งข้อความหา Agent ที่ Budget หมดแล้ว
- **THEN** ข้อความถูกตั้งเป็นส่งไม่สำเร็จ และใต้ข้อความมีคำที่บอกว่า Budget หมด

#### Scenario: เพิ่มแล้วพิมพ์ต่อ
- **WHEN** Owner กดปุ่มเพิ่ม Budget ตั้งค่าที่สูงกว่ายอด แล้วกลับมาส่งข้อความใน Task เดิม
- **THEN** Agent ตอบต่อจากบทสนทนาเดิม
