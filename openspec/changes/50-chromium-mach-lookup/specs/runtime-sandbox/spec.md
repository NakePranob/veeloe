## MODIFIED Requirements

### Requirement: macOS เปิดเฉพาะ system service ที่ worker ต้องใช้
profile ของ macOS SHALL ระบุ `mach-lookup` เป็นรายชื่อ service ที่ worker, toolchain และ headless browser ต้องใช้จริง MUST NOT เปิดทุก service ด้วย `(allow mach-lookup)` แบบไม่มีรายชื่อ คำขอไป service ที่ไม่อยู่ในรายชื่อ SHALL ถูกปฏิเสธและ SHALL เห็นได้ใน Runtime log รายชื่อที่อนุญาต SHALL มีเหตุผลกำกับว่ามาจาก worker, toolchain, OS หรือ browser service ของ headless browser ที่วัดแล้ว SHALL อยู่ในรายชื่อ; service ที่ยังไม่รู้ MUST NOT ถูกเพิ่มโดยเดา

#### Scenario: service ที่อนุญาต
- **WHEN** worker รันหนึ่ง Turn ที่ใช้ `git` และ `bun` ใต้รายชื่อใหม่
- **THEN** worker ขึ้น ready และ Turn จบตามปกติ

#### Scenario: headless browser
- **WHEN** Agent รัน headless browser ใต้รายชื่อใหม่
- **THEN** เปิดหน้า HTML และอ่าน DOM หรือถ่ายภาพได้

#### Scenario: service ที่ไม่อยู่ในรายชื่อ
- **WHEN** worker ขอ service ที่ไม่อยู่ในรายชื่อ
- **THEN** คำขอถูกปฏิเสธและ Runtime log แสดงการปฏิเสธนั้น
