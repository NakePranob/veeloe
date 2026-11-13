## ADDED Requirements

### Requirement: โดเมนนอก Egress ต้องขออนุญาตก่อน
เมื่อคำสั่งของ Agent ต่อโดเมนที่ไม่อยู่ใน Egress ของ Agent ตัวนั้น proxy SHALL สร้างคำขอ Approval ของ Turn ที่กำลังทำอยู่ และส่งถึง Member ที่มี Approve ที่ Agent นั้น (ADR 0010) ก่อนตัดสินใจ คำขอ SHALL มี Agent, Task, โดเมน และรหัสคำขอ คำตอบ SHALL มีสามแบบ: อนุญาตครั้งนี้, อนุญาตถาวร, ปฏิเสธ การอนุญาตถาวร SHALL เพิ่มโดเมนนั้นเข้า Egress ของ Agent ตัวนั้นเท่านั้น ด้วยคำสั่งที่ Owner เซ็น คำตอบจาก Member ที่ไม่มี Approve หรือไม่ได้เป็น Member ของ Turn นั้น MUST NOT ถูกใช้ timeout หรือการหยุด Turn SHALL นับเป็นการปฏิเสธ และ connection ถูกตัด MUST NOT มีทางผ่านโดยไม่มีการตอบ

#### Scenario: อนุญาตครั้งนี้
- **WHEN** โดเมนหนึ่งไม่อยู่ใน Egress และ Owner กดอนุญาตครั้งนี้
- **THEN** คำขอนั้นผ่าน แต่ Egress ไม่เปลี่ยน และคำขอถัดไปถามอีก

#### Scenario: อนุญาตถาวร
- **WHEN** Owner กดอนุญาตถาวร
- **THEN** โดเมนถูกเพิ่มใน Egress ของ Agent นั้น และคำขอถัดไปไม่ถามอีก

#### Scenario: ปฏิเสธ
- **WHEN** Owner กดปฏิเสธ หรือไม่ตอบจนหมดเวลา
- **THEN** connection ถูกตัดและ Agent เห็น error

#### Scenario: คนที่ไม่มีสิทธิ์
- **WHEN** Member ที่ไม่มี Approve ที่ Agent นั้นส่งคำตอบ
- **THEN** คำตอบถูกปฏิเสธและคำขอยังรออยู่หรือหมดเวลา
