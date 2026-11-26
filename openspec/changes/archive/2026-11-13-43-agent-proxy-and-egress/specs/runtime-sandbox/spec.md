## MODIFIED Requirements

### Requirement: Agent ออกเน็ตได้แค่โดเมนใน Egress
ภายใต้ sandbox การเชื่อมต่อเครือข่ายทุกทางของ worker และโปรเซสลูก SHALL ผ่าน proxy ของ Agent ตัวนั้น ซึ่งยอมเฉพาะโดเมนใน Egress ของ Agent นั้น worker MUST NOT ใช้ proxy หรือ Egress ของ Agent อื่น และ MUST NOT ต่อที่อยู่บนเครื่องเองได้ รวมถึง port ของโปรแกรมอื่นที่ฟังอยู่ที่ `127.0.0.1` ยกเว้น port ในช่วงของ Agent ตัวเอง คำขอไป LLM SHALL ไม่ต้องอยู่ใน Egress เพราะวิ่งผ่าน IPC (ADR 0029, 0042, 0069)

#### Scenario: โดเมนใน Egress
- **WHEN** Egress ของ Agent มี `registry.npmjs.org` แล้ว Agent รันคำสั่งที่ดาวน์โหลดจากโดเมนนั้น
- **THEN** ดาวน์โหลดได้ทั้งบน macOS และ Linux

#### Scenario: โดเมนนอก Egress
- **WHEN** Agent รัน `curl https://example.com` ขณะที่ Egress ของ Agent ไม่มีโดเมนนั้น
- **THEN** การเชื่อมต่อถูกปฏิเสธ

#### Scenario: ที่อยู่บนเครื่อง
- **WHEN** Agent ต่อ `127.0.0.1` ที่ port ของโปรแกรมอื่นซึ่งไม่ได้อยู่ในช่วงของ Agent
- **THEN** การเชื่อมต่อถูกปฏิเสธ

#### Scenario: Egress ของ Agent อื่น
- **WHEN** Agent A มีโดเมนหนึ่งใน Egress แต่ Agent B ไม่มี
- **THEN** คำสั่งของ B ไปโดเมนนั้นไม่ได้ และ B ใช้ proxy ของ A ไม่ได้

#### Scenario: คุยกับ LLM ขณะ Egress ว่าง
- **WHEN** Egress ว่างแล้ว Owner ส่งข้อความหา Agent
- **THEN** Agent ยังตอบได้ตามปกติ
