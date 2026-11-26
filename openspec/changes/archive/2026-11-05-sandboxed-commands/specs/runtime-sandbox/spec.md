## Purpose

กำหนดว่า worker ของ Agent ทุกตัวรันใน sandbox ระดับ OS อย่างไร อ่าน เขียน และออกเน็ตได้แค่ไหน เพื่อให้คำสั่งที่ Agent รัน รวมถึงโปรแกรมลูกที่คำสั่งนั้นเรียก อยู่ใต้กฎชุดเดียวที่ OS บังคับ (ADR 0008, 0032)

## ADDED Requirements

### Requirement: worker ทุกตัวรันใน sandbox ของ OS
supervisor SHALL เปิด worker ของทุก Agent ภายใน sandbox ของ OS ที่ครอบทั้งโปรเซส worker และทุกโปรเซสลูกของมัน supervisor MUST NOT เปิด worker นอก sandbox ไม่ว่ากรณีใด กฎของ sandbox SHALL เป็นของ Agent ตัวนั้นเอง และ worker SHALL คุยกับ supervisor ได้ทางช่อง IPC ของตัวเองเท่านั้น

#### Scenario: เปิด worker
- **WHEN** supervisor เปิด worker ของ Agent ตอนเริ่มหรือตอนสร้าง Agent ใหม่
- **THEN** worker และคำสั่งทุกตัวที่ worker รันอยู่ใต้ sandbox และ worker ยังรับข้อความกับส่ง event ผ่าน IPC ได้ตามปกติ

#### Scenario: worker พังแล้วเปิดใหม่
- **WHEN** worker จบเองแล้ว supervisor เปิดใหม่
- **THEN** worker ตัวใหม่อยู่ใต้ sandbox ด้วยกฎเดิม

### Requirement: Agent เขียนได้แค่ในโฟลเดอร์ของตัวเอง
ภายใต้ sandbox worker SHALL เขียนได้แค่ในโฟลเดอร์ `<VEELOE_HOME>/agents/<agent-id>/` ของ Agent ตัวเอง ซึ่งมี Workdir, `tmp/` และ `tasks.db` การเขียนที่อื่นบนเครื่อง SHALL ล้มเหลว รวมถึงการเขียนผ่าน symlink หรือ hard link ที่ชี้ออกไปข้างนอก worker แต่ละตัว SHALL มีโฟลเดอร์ชั่วคราวของตัวเอง และ MUST NOT ใช้โฟลเดอร์ชั่วคราวร่วมกับ Agent ตัวอื่น

#### Scenario: เขียนใน Workdir
- **WHEN** Agent รันคำสั่งที่สร้างไฟล์ใน Workdir
- **THEN** ไฟล์ถูกสร้าง

#### Scenario: เขียนนอกโฟลเดอร์ของตัวเอง
- **WHEN** Agent รันคำสั่งที่เขียน `~/.zshrc`, Workdir ของ Agent อื่น หรือไฟล์ใน `runtime/`
- **THEN** คำสั่งได้ error จาก OS และไฟล์ไม่เปลี่ยน

#### Scenario: เขียนผ่าน symlink
- **WHEN** Agent สร้าง symlink ใน Workdir ที่ชี้ไปนอกโฟลเดอร์ของตัวเอง แล้วเขียนผ่าน symlink นั้น
- **THEN** การเขียนล้มเหลว

### Requirement: Agent อ่านโฟลเดอร์ของ Runtime และไฟล์ลับไม่ได้
ภายใต้ sandbox worker MUST NOT อ่านอะไรใน `<VEELOE_HOME>` นอกจากโฟลเดอร์ของ Agent ตัวเองและ binary ของ Runtime ซึ่งรวมถึงกุญแจของ Machine, `runtime/` ที่มีกุญแจที่ไว้ใจกับ key ของ Provider และโฟลเดอร์ของ Agent ตัวอื่น worker MUST NOT อ่านไฟล์ลับในรายชื่อที่ Runtime กำหนด เช่น `~/.ssh`, `~/.aws`, `~/.gnupg`, credential ของ git กับ package manager และ keychain ของ OS การอ่านผ่าน symlink หรือ hard link SHALL ได้ผลเดียวกับการอ่านตรง ไฟล์อื่นบนเครื่อง worker SHALL อ่านได้ เพราะใน v0.1 ทุก Turn เป็นของ Owner ซึ่งมี Manage (ADR 0008)

#### Scenario: อ่านไฟล์ลับ
- **WHEN** Agent รัน `cat ~/.ssh/id_ed25519` หรืออ่านผ่าน symlink ใน Workdir ที่ชี้ไปไฟล์นั้น
- **THEN** คำสั่งได้ error จาก OS และ LLM ไม่ได้เนื้อหาของไฟล์

#### Scenario: อ่าน key ของ Provider
- **WHEN** Agent รันคำสั่งที่อ่าน `<VEELOE_HOME>/runtime/providers.json`
- **THEN** คำสั่งได้ error จาก OS

#### Scenario: อ่าน Workdir ของ Agent อื่น
- **WHEN** Agent ตัวหนึ่งรัน `ls` ที่ Workdir ของอีกตัว
- **THEN** คำสั่งได้ error จาก OS

#### Scenario: อ่านไฟล์ทั่วไป
- **WHEN** Agent อ่านไฟล์ที่ไม่ได้อยู่ในรายชื่อไฟล์ลับและไม่ได้อยู่ใน `<VEELOE_HOME>` เช่น `/etc/hosts`
- **THEN** อ่านได้

### Requirement: Agent ออกเน็ตได้แค่โดเมนใน Egress
ภายใต้ sandbox การเชื่อมต่อเครือข่ายทุกทางของ worker และโปรเซสลูก SHALL ผ่านตัวกรองของ supervisor ซึ่งยอมเฉพาะโดเมนใน Egress ของ Machine worker MUST NOT ต่อที่อยู่บนเครื่องเองได้ รวมถึง port ของโปรแกรมอื่นที่ฟังอยู่ที่ `127.0.0.1` คำขอไป LLM SHALL ไม่ต้องอยู่ใน Egress เพราะวิ่งผ่าน IPC (ADR 0029, 0042)

#### Scenario: โดเมนใน Egress
- **WHEN** Egress มี `registry.npmjs.org` แล้ว Agent รันคำสั่งที่ดาวน์โหลดจากโดเมนนั้น
- **THEN** ดาวน์โหลดได้

#### Scenario: โดเมนนอก Egress
- **WHEN** Agent รัน `curl https://example.com` ขณะที่ Egress ไม่มีโดเมนนั้น
- **THEN** การเชื่อมต่อถูกปฏิเสธ และคำสั่งได้ error

#### Scenario: ที่อยู่บนเครื่อง
- **WHEN** Agent ต่อ `127.0.0.1` ที่ port ใดก็ตาม
- **THEN** การเชื่อมต่อถูกปฏิเสธ

#### Scenario: คุยกับ LLM ขณะ Egress ว่าง
- **WHEN** Egress ว่างแล้ว Owner ส่งข้อความหา Agent
- **THEN** Agent ยังตอบได้ตามปกติ

### Requirement: Agent แตะโปรเซสนอก sandbox ไม่ได้
ภายใต้ sandbox worker และโปรเซสลูก MUST NOT ส่ง signal ถึงโปรเซสนอก sandbox ของตัวเอง รวมถึง supervisor และ worker ของ Agent ตัวอื่น และ MUST NOT อ่าน environment ของโปรเซสเหล่านั้น

#### Scenario: kill supervisor
- **WHEN** Agent รัน `kill` ที่ pid ของ supervisor
- **THEN** คำสั่งได้ error และ supervisor ทำงานต่อ

### Requirement: เครื่องที่ทำ sandbox ไม่ได้ไม่เปิด worker
ตอนเริ่ม supervisor SHALL ตรวจว่าเครื่องทำ sandbox ได้ ถ้า OS ไม่ใช่ macOS หรือ Linux หรือขาดโปรแกรมที่ sandbox ต้องใช้ supervisor SHALL ไม่เปิด worker ตัวใด SHALL พิมพ์ใน terminal ว่าขาดอะไรและติดตั้งอย่างไร และ SHALL จบด้วย exit code ที่ไม่ใช่ 0 บน Windows ให้ใช้รุ่น Linux ใน WSL2 (ADR 0008)

#### Scenario: Linux ที่ไม่มี bubblewrap
- **WHEN** Owner รัน `veeloe` บน Linux ที่ไม่มี bubblewrap
- **THEN** terminal บอกว่าขาด bubblewrap พร้อมคำสั่งติดตั้ง และไม่มี worker ตัวใดถูกเปิด

#### Scenario: macOS
- **WHEN** Owner รัน `veeloe` บน macOS
- **THEN** supervisor เปิด worker ใน sandbox ได้โดยไม่ต้องติดตั้งอะไรเพิ่ม
