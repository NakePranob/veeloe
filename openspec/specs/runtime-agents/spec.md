# runtime-agents Specification

## Purpose

กำหนดว่า supervisor สร้าง Agent เก็บรายชื่อ และดูแล worker หนึ่งโปรเซสต่อ Agent อย่างไร เพื่อให้ Agent ตัวหนึ่งค้างหรือพังโดยไม่ลาก Agent ตัวอื่นและการเชื่อมต่อกับ Hub ไปด้วย (ADR 0020)

## Requirements

### Requirement: Owner สร้าง Agent จาก Controller
supervisor SHALL สร้าง Agent เมื่อได้คำสั่งสร้างที่เซ็นด้วยกุญแจของ Owner ที่ไว้ใจ คำสั่ง SHALL ระบุรหัส, ชื่อ, Provider และ model ซึ่ง Provider กับ model SHALL มีอยู่บน Machine supervisor SHALL เก็บรายชื่อ Agent ในไฟล์ของตัวเองให้อยู่รอดข้ามการเริ่มใหม่ และ SHALL สร้าง Workdir ที่ `<VEELOE_HOME>/agents/<agent-id>/workdir` โดย Member เลือกที่อยู่ไม่ได้ (ADR 0032) คำสั่งเดิมที่ส่งซ้ำ SHALL ได้ผลเดิมโดยไม่สร้าง Agent ใหม่

#### Scenario: สร้างสำเร็จ
- **WHEN** Owner ส่งคำสั่งสร้างที่มี Provider กับ model ที่ Machine มี
- **THEN** supervisor บันทึก Agent สร้าง Workdir เปิด worker และตอบรายชื่อ Agent ที่มีตัวใหม่

#### Scenario: Provider หรือ model ไม่มี
- **WHEN** คำสั่งสร้างระบุ Provider หรือ model ที่ Machine ไม่มี
- **THEN** supervisor ตอบ error code `agent.provider_unknown` และไม่สร้างอะไร

#### Scenario: คนที่ไม่ได้รับความไว้ใจ
- **WHEN** คำสั่งสร้างเซ็นด้วยกุญแจที่ไม่อยู่ใน trust
- **THEN** supervisor ทิ้งคำสั่งและไม่ตอบ

#### Scenario: ส่งซ้ำ
- **WHEN** คำสั่งสร้างด้วยรหัสเดิมมาถึงอีกครั้ง
- **THEN** ยังมี Agent ตัวเดียวและ Workdir เดิม

### Requirement: Controller ขอรายชื่อ Agent และ Provider ได้
supervisor SHALL ตอบคำขอรายชื่อที่เซ็นด้วยกุญแจที่ไว้ใจ ด้วยรายชื่อ Agent และรายชื่อ Provider พร้อม model ของแต่ละตัว คำตอบ MUST NOT มี key หรือ URL ของ Provider

#### Scenario: ขอรายชื่อ
- **WHEN** Controller ส่งคำขอรายชื่อ
- **THEN** ได้รายชื่อ Agent กับชื่อ Provider และ model ที่เลือกได้ และไม่มี key

#### Scenario: Provider ตอบรายชื่อ model ไม่ได้
- **WHEN** supervisor ถาม model จาก Provider ไม่สำเร็จ
- **THEN** Provider นั้นอยู่ในคำตอบพร้อม error code แทนรายชื่อ model และ Provider ตัวอื่นยังมีรายชื่อครบ

### Requirement: Agent แต่ละตัวมี worker ของตัวเอง
supervisor SHALL เปิด worker หนึ่งโปรเซสต่อ Agent ด้วย binary ตัวเดียวกันในโหมด `veeloe worker --agent <id>` ทั้งตอนเริ่มและเมื่อสร้าง Agent ใหม่ supervisor กับ worker SHALL คุยกันทาง IPC เท่านั้น เมื่อ worker จบเองโดยไม่ได้สั่ง supervisor SHALL เปิดใหม่ด้วยเว้นระยะที่ยาวขึ้น และ Agent ตัวอื่นกับการเชื่อมต่อกับ Hub SHALL ทำงานต่อ

#### Scenario: worker พัง
- **WHEN** worker ของ Agent ตัวหนึ่งจบเองกลางทาง
- **THEN** supervisor เปิดใหม่ และ Agent ตัวอื่นยังตอบข้อความได้ระหว่างนั้น

#### Scenario: เริ่ม Runtime ใหม่
- **WHEN** Owner รัน `veeloe` บนเครื่องที่มี Agent อยู่แล้ว
- **THEN** supervisor เปิด worker ของทุก Agent ในรายชื่อ

### Requirement: supervisor ส่งต่อเฉพาะคำสั่งที่ตรวจแล้ว
supervisor SHALL ตรวจลายเซ็น กุญแจที่ไว้ใจ และเลขลำดับของทุกซองก่อนส่งต่อให้ worker และ SHALL ส่งให้ worker แค่เนื้อหาที่ตรวจแล้วพร้อม Member เจ้าของกุญแจ worker MUST NOT รับซองจาก Hub โดยตรง ข้อความถึง Agent ที่ไม่มี SHALL ได้ error code `agent.unknown`

#### Scenario: ลายเซ็นผิด
- **WHEN** ข้อความถึง Agent มีลายเซ็นผิดหรือเป็นซองเก่าที่ส่งซ้ำ
- **THEN** worker ไม่ได้รับอะไร

#### Scenario: Agent ไม่มี
- **WHEN** Owner ส่งข้อความถึงรหัส Agent ที่ไม่มีบน Machine
- **THEN** Controller ได้ error code `agent.unknown`

### Requirement: เริ่มเครื่องใหม่แล้วไม่เห็น Agent เดิม
`veeloe unpair` SHALL ลบรายชื่อ Agent ไปพร้อมกุญแจที่ไว้ใจ เพื่อให้ Workspace ที่ Pairing ครั้งถัดไปเริ่มจากศูนย์ (ADR 0035) โฟลเดอร์ของ Agent เดิม SHALL อยู่บนดิสก์ต่อจนกว่าเจ้าของเครื่องจะลบเอง

#### Scenario: Pairing ใหม่หลัง unpair
- **WHEN** เจ้าของรัน `veeloe unpair` แล้วทำ Pairing กับ Controller ใหม่
- **THEN** Controller ใหม่ได้รายชื่อ Agent ว่าง และโฟลเดอร์ `agents/` เดิมยังอยู่

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
