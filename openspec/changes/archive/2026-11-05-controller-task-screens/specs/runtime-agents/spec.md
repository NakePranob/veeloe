## ADDED Requirements

### Requirement: Agent เก็บ Character ที่ Controller เลือกตอนสร้าง
คำสั่งสร้าง Agent SHALL มี field `character` ที่ไม่บังคับ คือ `color` เป็นสีแบบ `#rrggbb` และ `shell`, `top`, `sides`, `decal` เป็นคำตัวพิมพ์เล็กสั้นๆ ไม่เกิน 32 ตัว Protocol SHALL ตรวจรูปนี้ที่ขอบของข้อความ ทั้งในคำสั่งสร้างและใน Agent ของรายชื่อ ข้อความที่มี `character` ผิดรูป SHALL ไม่ผ่านเหมือน field อื่นที่ผิดรูป ส่วนชิ้นส่วนที่ Machine ไม่รู้จัก SHALL ผ่าน เพราะ Machine ไม่ได้วาด (ADR 0023) supervisor SHALL เก็บ `character` ไว้กับ Agent ในไฟล์รายชื่อของตัวเองให้อยู่รอดข้ามการเริ่มใหม่ และ SHALL ส่งกลับในรายชื่อ Agent ทุกครั้ง คำสั่งสร้างที่ส่งซ้ำด้วยรหัสเดิม SHALL ไม่เปลี่ยน `character` ที่เก็บไว้ Agent ที่สร้างโดยไม่มี `character` SHALL อยู่ในรายชื่อโดยไม่มี field นี้

#### Scenario: สร้างพร้อม Character
- **WHEN** Owner ส่งคำสั่งสร้างที่มี `character`
- **THEN** รายชื่อ Agent ที่ตอบกลับมี `character` นั้นกับ Agent ตัวใหม่

#### Scenario: เริ่ม Runtime ใหม่
- **WHEN** Owner รัน `veeloe` ใหม่ แล้ว Controller ขอรายชื่อ
- **THEN** Agent มี `character` เดิมที่ส่งมาตอนสร้าง

#### Scenario: Character ผิดรูป
- **WHEN** คำสั่งสร้างมี `character` ที่สีไม่ใช่ `#rrggbb` หรือชิ้นส่วนยาวเกินหรือไม่ใช่คำตัวพิมพ์เล็ก
- **THEN** supervisor ไม่สร้าง Agent

#### Scenario: Agent ที่สร้างก่อนมี Character
- **WHEN** `agents.json` มี Agent ที่ไม่มี `character`
- **THEN** supervisor ยังเปิด worker ของ Agent นั้น และส่ง Agent นั้นในรายชื่อโดยไม่มี `character`
