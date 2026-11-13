## ADDED Requirements

### Requirement: Controller แก้ Egress ต่อ Agent ได้
Controller SHALL ให้ Owner เลือก Agent ในหน้า Machines → Egress และเพิ่มหรือลบโดเมนของ Agent ตัวนั้น โดยส่ง `egress.set` ที่ระบุ Agent และ SHALL แสดงรายการที่ Machine เซ็นกลับมาของ Agent นั้น ตัวเลือกที่แก้ทุก Agent พร้อมกัน SHALL ยังใช้ได้และ MUST NOT ทำให้รายการของ Agent แต่ละตัวหาย Egress ของ Agent SHALL ถูกเก็บในเครื่องและยังอยู่หลังปิดเปิดแอป

#### Scenario: แก้ของ Agent หนึ่ง
- **WHEN** Owner เลือก Agent A แล้วเพิ่มโดเมน
- **THEN** คำขอระบุ Agent A และรายการของ Agent อื่นไม่เปลี่ยน

#### Scenario: แก้ทุก Agent
- **WHEN** Owner เลือก "ทุก Agent" แล้วเพิ่มโดเมน
- **THEN** คำขอไม่ระบุ Agent และทุก Agent ได้โดเมนนั้น

#### Scenario: ปิดเปิดแอป
- **WHEN** Owner ปิดและเปิดแอปใหม่
- **THEN** Egress ของแต่ละ Agent ยังแสดงตามที่ Machine เซ็นกลับมาล่าสุด
