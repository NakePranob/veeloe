## ADDED Requirements

### Requirement: ชุด tool สำหรับ Workdir และขอบเขต path

worker SHALL ให้ tool `read`, `write`, `edit`, `glob` และ `grep` แก่ Agent ทุกตัวที่เขียน Workdir ได้ path SHALL ตีความเป็น relative กับ Workdir หรือ absolute ที่อยู่ภายใน Workdir และ tool MUST NOT อ่านหรือเขียนนอก Workdir แม้ sandbox ของ worker จะอนุญาตก็ตาม tool MUST NOT ตาม symlink ที่ชี้ไปนอก Workdir ความผิดพลาดของ tool SHALL เป็นข้อความที่ LLM อ่านได้และ MUST NOT ทำให้ worker จบ

#### Scenario: path relative และ absolute ที่อยู่ข้างใน
- **WHEN** Agent เรียก `read` ด้วย `src/index.ts` หรือ absolute path ของไฟล์นั้น
- **THEN** tool อ่านไฟล์เดียวกันได้

#### Scenario: path ที่ออกนอก Workdir
- **WHEN** Agent เรียก `read` ด้วย `../other-agent/workdir/secret` หรือ absolute path นอก Workdir
- **THEN** tool ตอบ error ว่า path อยู่นอก Workdir และไม่อ่านไฟล์นั้น

#### Scenario: symlink ที่ชี้ไปนอก Workdir
- **WHEN** มี symlink ใน Workdir ชี้ไปยังไฟล์นอก Workdir แล้ว Agent เรียก `read` หรือ `write` ผ่าน symlink นั้น
- **THEN** tool ปฏิเสธและไม่แตะไฟล์ปลายทาง

### Requirement: `read` อ่านไฟล์พร้อมเลขบรรทัดและขอบเขต

`read` SHALL คืนเนื้อหาไฟล์โดยมีเลขบรรทัดเริ่มที่ 1 และรองรับ `offset` (บรรทัดเริ่ม) กับ `limit` (จำนวนบรรทัด) ไฟล์ที่ยาวเกิน 2,000 บรรทัดหรือ 256KB SHALL ถูกตัดและบอกว่าเหลือเท่าไร ไฟล์ที่ใหญ่กว่า 10MB SHALL ถูกปฏิเสธให้ใช้ `grep` หรือ `bash` แทน ไฟล์ไบนารี ไฟล์ที่อ่านไม่ได้ และไฟล์ที่ไม่มี SHALL ได้ error ที่บอกสาเหตุ

#### Scenario: ไฟล์สั้น
- **WHEN** Agent อ่านไฟล์ 3 บรรทัด
- **THEN** ผลลัพธ์มีเลขบรรทัด 1 ถึง 3 ครบทุกบรรทัด

#### Scenario: อ่านบางช่วง
- **WHEN** Agent ระบุ `offset` 10 และ `limit` 5
- **THEN** ผลลัพธ์เริ่มที่บรรทัด 10 และมี 5 บรรทัด

#### Scenario: ไฟล์ใหญ่
- **WHEN** ไฟล์ยาว 5,000 บรรทัด
- **THEN** ผลลัพธ์ถูกตัดที่ขอบเขตและบอกว่าตัดไปกี่บรรทัดหรือกี่ไบต์

#### Scenario: ไฟล์ไบนารีหรือไม่มีไฟล์
- **WHEN** Agent อ่านไฟล์ที่มี NUL ไบต์ หรือไฟล์ที่ไม่มีอยู่
- **THEN** tool ตอบ error ที่บอกว่าเป็นไฟล์ไบนารีหรือไม่พบไฟล์

#### Scenario: ไฟล์ใหญ่กว่า 10MB
- **WHEN** Agent อ่านไฟล์ขนาด 20MB
- **THEN** tool ปฏิเสธและบอกให้ใช้ `grep` หรือ `bash` แทน

### Requirement: `write` เขียนไฟล์แบบ atomic ภายใน Workdir

`write` SHALL เขียนเนื้อหาใหม่ทับไฟล์หรือสร้างไฟล์ใหม่ SHALL สร้างโฟลเดอร์พ่อที่ยังไม่มี SHALL เขียนลงไฟล์ชั่วคราวในโฟลเดอร์เดียวกันแล้ว rename ทับเพื่อไม่ให้ไฟล์ครึ่ง ๆ กลาง ๆ ค้างอยู่ และ SHALL คืนจำนวนไบต์ที่เขียน ไฟล์ใหม่หรือเนื้อหาใหม่ที่เกิน 2MB SHALL ถูกปฏิเสธ

#### Scenario: สร้างไฟล์ในโฟลเดอร์ใหม่
- **WHEN** Agent เขียน `src/deep/new.ts` ที่ยังไม่มีโฟลเดอร์
- **THEN** tool สร้างโฟลเดอร์และไฟล์ แล้วคืนจำนวนไบต์

#### Scenario: เขียนทับไฟล์เดิม
- **WHEN** Agent เขียนทับไฟล์ที่มีอยู่
- **THEN** เนื้อหาเดิมถูกแทนทั้งหมดและไม่มีไฟล์ชั่วคราวค้าง

#### Scenario: เนื้อหาใหญ่เกิน
- **WHEN** Agent เขียนเนื้อหายาวเกิน 2MB
- **THEN** tool ปฏิเสธและไม่เขียนอะไร

### Requirement: `edit` แทนข้อความที่ตรงทั้งหมด

`edit` SHALL แทน `old_string` ด้วย `new_string` ในไฟล์เดียว SHALL เจอ `old_string` ครั้งเดียว เว้นแต่ผู้เรียกส่ง `replace_all: true` ถ้าไม่พบหรือพบมากกว่าหนึ่งครั้งโดยไม่ขอ `replace_all` SHALL ตอบ error พร้อมจำนวนที่พบ และ SHALL ไม่แก้ไฟล์ การเขียน SHALL เป็น atomic และ SHALL คงสิทธิ์ของไฟล์เดิม

#### Scenario: เจอครั้งเดียว
- **WHEN** Agent แก้ข้อความที่ปรากฏครั้งเดียวในไฟล์
- **THEN** ข้อความถูกแทนและไฟล์ถูกเขียนกลับโดยสิทธิ์เดิม

#### Scenario: ไม่เจอ
- **WHEN** `old_string` ไม่ปรากฏในไฟล์
- **THEN** tool ตอบ error ว่าพบ 0 ครั้ง และไฟล์ไม่เปลี่ยน

#### Scenario: เจอหลายครั้ง
- **WHEN** `old_string` ปรากฏ 3 ครั้งและไม่ได้ขอ `replace_all`
- **THEN** tool ตอบ error ว่าพบ 3 ครั้ง และไฟล์ไม่เปลี่ยน

#### Scenario: แทนทั้งหมด
- **WHEN** Agent ขอ `replace_all: true` และข้อความปรากฏ 3 ครั้ง
- **THEN** ทั้ง 3 ครั้งถูกแทนในครั้งเดียว

### Requirement: `glob` หาไฟล์ใน Workdir

`glob` SHALL หาไฟล์ที่ตรง pattern จากรากของ Workdir SHALL คืน path แบบ relative เรียงตามตัวอักษร SHALL จำกัดผลลัพธ์ที่ 200 ไฟล์ SHALL ข้าม `.git` และ `node_modules` และ MUST NOT คืนโฟลเดอร์

#### Scenario: หาไฟล์ตาม pattern
- **WHEN** Agent เรียก `glob` ด้วย `src/**/*.ts`
- **THEN** ได้ path ของไฟล์ `.ts` ใต้ `src` เรียงตามตัวอักษร

#### Scenario: ผลเกินเพดาน
- **WHEN** pattern ตรงกับไฟล์ 500 ไฟล์
- **THEN** tool คืน 200 ไฟล์แรกและบอกว่ามีมากกว่านั้น

#### Scenario: ไม่มีไฟล์ตรง
- **WHEN** pattern ไม่ตรงกับไฟล์ใด
- **THEN** tool คืนข้อความว่าไม่พบไฟล์ ไม่ใช่ error

### Requirement: `grep` ค้นข้อความในไฟล์ Workdir

`grep` SHALL ค้นข้อความหรือ regular expression ในไฟล์ที่ตรง `include` glob ภายใน Workdir SHALL คืน `path:line: ข้อความ` SHALL จำกัดที่ 200 บรรทัดที่ตรง SHALL รองรับ `ignore_case` SHALL ข้าม `.git`, `node_modules`, ไฟล์ไบนารี และไฟล์ที่ใหญ่กว่า 1MB regular expression ที่ไม่ถูกต้อง SHALL ได้ error

#### Scenario: พบข้อความ
- **WHEN** Agent ค้น `TODO` ด้วย `include: "src/**/*.ts"`
- **THEN** ผลลัพธ์มี path และเลขบรรทัดของทุกที่ที่พบภายในเพดาน

#### Scenario: ค้นแบบไม่สนตัวพิมพ์
- **WHEN** Agent ส่ง `ignore_case: true` และค้น `todo`
- **THEN** พบทั้ง `TODO` และ `todo`

#### Scenario: ผลเกินเพดาน
- **WHEN** พบมากกว่า 200 บรรทัด
- **THEN** tool คืน 200 บรรทัดแรกและบอกว่ามีมากกว่านั้น

#### Scenario: regex ไม่ถูกต้อง
- **WHEN** Agent ส่ง pattern ที่ compile ไม่ได้
- **THEN** tool ตอบ error ว่า pattern ไม่ถูกต้อง

### Requirement: โหมดอ่านอย่างเดียวสำหรับ Subagent

`fileTools({ readOnly: true })` SHALL มีเฉพาะ `read`, `glob` และ `grep` ใน definitions และการเรียก `write` หรือ `edit` ผ่าน runner นั้น SHALL error ชุดเต็ม SHALL ใช้กับ Agent ที่เขียน Workdir ได้ตาม ADR 0011

#### Scenario: Subagent เห็นแค่ tool อ่าน
- **WHEN** สร้าง runner ด้วย `readOnly: true`
- **THEN** `definitions()` มีสามชื่อและไม่มี `write`/`edit`

#### Scenario: เรียกเขียนผ่าน runner อ่านอย่างเดียว
- **WHEN** เรียก `write` หรือ `edit` ผ่าน runner ที่ `readOnly: true`
- **THEN** tool ตอบ error ว่าไม่มี tool นั้น

### Requirement: ประกอบ tool หลายชุดเป็น runner เดียว

worker SHALL ส่ง `bash` กับ file tools ให้ LLM ผ่าน `ToolRunner` เดียว ชื่อ tool ทุกตัว SHALL ไม่ซ้ำ และการเรียกชื่อที่ไม่รู้จัก SHALL ได้ error

#### Scenario: LLM เห็น tool ครบ
- **WHEN** worker สร้าง runner จาก `bash` กับ file tools
- **THEN** `definitions()` มี `bash`, `read`, `write`, `edit`, `glob` และ `grep` อย่างละหนึ่ง

#### Scenario: ชื่อที่ไม่รู้จัก
- **WHEN** LLM เรียก `delete`
- **THEN** runner ตอบ error ว่าไม่มี tool นั้น
