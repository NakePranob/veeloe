## MODIFIED Requirements

### Requirement: worker คุยกับ LLM ผ่าน proxy ของ supervisor เท่านั้น
supervisor SHALL รับคำขอไป LLM จาก worker ผ่านช่อง IPC ของ worker ตัวนั้นเท่านั้น ใส่ key ของ Provider ที่ Agent ตัวนั้นใช้ แล้วส่งต่อ Agent ที่เป็นเจ้าของคำขอ SHALL มาจากช่อง IPC ที่คำขอเข้ามา ไม่ใช่จากสิ่งที่คำขอระบุ supervisor MUST NOT เปิด port บนเครื่องให้ worker เรียก LLM worker MUST NOT ได้รับ key ทั้งทางตัวแปร environment, IPC หรือคำตอบ supervisor SHALL ใช้ Provider กับ model ของ Agent ตัวนั้น ไม่ใช่ค่าที่คำขอระบุ และ SHALL ส่งต่อเฉพาะ path ที่ใช้คุยกับ LLM (ADR 0008, 0042)

#### Scenario: worker ขอ LLM
- **WHEN** worker ส่งคำขอทาง IPC ของตัวเอง
- **THEN** Provider ได้คำขอพร้อม key และ worker ได้คำตอบตามที่ Provider ตอบ

#### Scenario: โปรเซสอื่นบนเครื่อง
- **WHEN** โปรเซสบนเครื่องที่ไม่ใช่ worker ลองหาทางเรียก LLM ผ่าน supervisor
- **THEN** ไม่มี port ให้ต่อ และ supervisor ไม่ติดต่อ Provider

#### Scenario: worker ขอ model อื่น
- **WHEN** คำขอของ worker ระบุ model ที่ไม่ใช่ของ Agent
- **THEN** Provider ได้คำขอด้วย model ของ Agent

#### Scenario: worker ขอ path อื่น
- **WHEN** worker ขอ path ที่ไม่ใช่การส่งข้อความหรือนับ token
- **THEN** supervisor ปฏิเสธและไม่ติดต่อ Provider

#### Scenario: Provider ล่ม
- **WHEN** ติดต่อ Provider ไม่ได้ หรือ Provider ตอบ error
- **THEN** worker ได้ error ที่บอกว่าเป็นที่ Provider และ Turn จบด้วย code `provider.failed` หรือ `provider.unreachable`
