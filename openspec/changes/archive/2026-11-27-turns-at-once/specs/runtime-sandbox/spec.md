## MODIFIED Requirements

### Requirement: โดเมนนอก Egress ต้องขออนุญาตก่อน
เมื่อคำสั่งของ Agent ต่อโดเมนที่ไม่อยู่ใน Egress ของ Agent ตัวนั้น proxy SHALL สร้างคำขอ Approval ของ Turn ที่คำขอนั้นมาจาก และส่งถึง Member ที่มี Approve ที่ Agent นั้น (ADR 0010) ก่อนตัดสินใจ Agent มีหลาย Turn พร้อมกันได้ (ADR 0080) คำขอที่ผ่าน proxy SHALL บอกได้ว่ามาจาก Turn ไหน และคำขอที่บอกไม่ได้หรือมาจาก Turn ที่จบแล้ว SHALL ถูกปฏิเสธ คำขอ Approval SHALL มี Agent, Task, โดเมน และรหัสคำขอ คำตอบ SHALL มีสามแบบ: อนุญาตครั้งนี้, อนุญาตถาวร, ปฏิเสธ การอนุญาตถาวร SHALL เพิ่มโดเมนนั้นเข้า Egress ของ Agent ตัวนั้นเท่านั้น ด้วยคำสั่งที่ Owner เซ็น คำตอบจาก Member ที่ไม่มี Approve หรือไม่ได้เป็น Member ของ Turn นั้น MUST NOT ถูกใช้ timeout หรือการหยุด Turn SHALL นับเป็นการปฏิเสธ และ connection ถูกตัด MUST NOT มีทางผ่านโดยไม่มีการตอบ

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

#### Scenario: สอง Turn ขอโดเมนพร้อมกัน
- **WHEN** Turn ของ Task A ที่ Nok เริ่ม และ Turn ของ Task B ที่ Owner เริ่ม ต่อโดเมนนอก Egress พร้อมกัน
- **THEN** คำขอ Approval ของแต่ละ Turn อยู่ใน Task ของตัวเองและผูกกับคนเริ่มของ Task นั้น

#### Scenario: Turn ของรอบที่ไม่มีคนเฝ้า
- **WHEN** รอบของ Schedule ที่ไม่มีคนเฝ้าต่อโดเมนนอก Egress ระหว่างที่ Turn ของคนใน Task อื่นกำลังทำ
- **THEN** คำขอนั้นถูกปฏิเสธทันทีและ `approval.skipped` อยู่ใน Task ของรอบ ไม่ถาม Member ของอีก Turn
