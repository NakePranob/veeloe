## MODIFIED Requirements

### Requirement: Agent อ่านโฟลเดอร์ของ Runtime และไฟล์ลับไม่ได้
ภายใต้ sandbox worker SHALL อ่านได้เฉพาะ path ที่ Runtime เปิดให้: path ระบบที่โปรแกรมต้องใช้ (เช่น `/usr`, `/bin`, `/System`, `/dev`, `/etc`), toolchain ที่ติดตั้งในที่มาตรฐานของ OS ทุก layout ที่ตัวติดตั้งมาตรฐานใช้ (Command Line Tools, Xcode, Homebrew และ framework-style เช่น `/Library/Frameworks` กับ `/Library/Python` บน macOS), binary ของ Runtime และโฟลเดอร์ของ Agent ตัวเอง ทั้งหมดนอกจากโฟลเดอร์ของ Agent SHALL อ่านได้อย่างเดียว worker MUST NOT อ่าน home ของเจ้าของเครื่อง, `<VEELOE_HOME>` นอกจากโฟลเดอร์ของตัวเอง ซึ่งรวมถึงกุญแจของ Machine, `runtime/` และโฟลเดอร์ของ Agent ตัวอื่น และ path อื่นที่ไม่ได้เปิดไว้ แม้เป็น Turn ของ Owner และแม้คำสั่งได้ Approval แล้ว การอ่านผ่าน symlink หรือ hard link SHALL ได้ผลเดียวกับการอ่านตรง (ADR 0068, 0069)

#### Scenario: อ่านไฟล์ลับ
- **WHEN** Agent รัน `cat ~/.ssh/id_ed25519` หรืออ่านผ่าน symlink ใน Workdir ที่ชี้ไปไฟล์นั้น
- **THEN** คำสั่งได้ error จาก OS และ LLM ไม่ได้เนื้อหาของไฟล์

#### Scenario: อ่าน key ของ Provider
- **WHEN** Agent รันคำสั่งที่อ่าน `<VEELOE_HOME>/runtime/providers.json`
- **THEN** คำสั่งได้ error จาก OS

#### Scenario: อ่าน Workdir ของ Agent อื่น
- **WHEN** Agent ตัวหนึ่งรัน `ls` ที่ Workdir ของอีกตัว
- **THEN** คำสั่งได้ error จาก OS

#### Scenario: อ่านโปรเจกต์อื่นใน home ของเจ้าของ
- **WHEN** Agent รัน `ls ~` หรือ `cat ~/Develop/app/.env` แม้ Owner กดอนุมัติคำสั่งนั้นแล้ว
- **THEN** คำสั่งได้ error จาก OS

#### Scenario: ใช้ toolchain ของเครื่อง
- **WHEN** Agent รัน `git --version`, `python3 -c 'print(1)'` หรือ `bun --version` ที่ติดตั้งไว้ในที่มาตรฐาน
- **THEN** คำสั่งทำงานได้

#### Scenario: toolchain ที่ติดตั้งแบบ framework
- **WHEN** Agent รัน `python3` บนเครื่องที่ Python มาจากตัวติดตั้ง python.org และ framework อยู่ใต้ `/Library/Frameworks`
- **THEN** คำสั่งทำงานได้

#### Scenario: อ่านไฟล์ทั่วไป
- **WHEN** Agent อ่านไฟล์ระบบที่อยู่ใน path ที่เปิดไว้ เช่น `/etc/hosts`
- **THEN** อ่านได้

## ADDED Requirements

### Requirement: Runtime รายงาน toolchain ที่ใช้ไม่ได้ตอนเปิด worker
supervisor SHALL ตรวจ toolchain หลัก (`git`, `python3`, `node`, `bun`) ใต้ policy เดียวกับ worker เมื่อเปิด worker และ SHALL บันทึกผลเป็น log ระดับ Runtime ว่าแต่ละตัวใช้ได้หรือไม่ ข้อมูลที่บันทึก SHALL มีชื่อ tool กับผลเท่านั้น MUST NOT มี path ใน home ของเจ้าของเครื่องหรือเนื้อหาไฟล์ของผู้ใช้ toolchain ที่ใช้ไม่ได้ MUST NOT ทำให้ worker ไม่เปิด และ MUST NOT ทำให้ Turn จบ การขาด toolchain SHALL เป็นข้อมูลให้ Owner แก้ ไม่ใช่เหตุให้ fail closed ซึ่งสงวนไว้สำหรับกรณีที่ sandbox เริ่มไม่ได้ (ADR 0069)

#### Scenario: toolchain ครบ
- **WHEN** supervisor เปิด worker บนเครื่องที่มี `git`, `python3`, `node` และ `bun`
- **THEN** Runtime log มีผลว่าทั้งสี่ตัวใช้ได้ และ worker ขึ้น ready ตามปกติ

#### Scenario: toolchain ขาด
- **WHEN** supervisor เปิด worker บนเครื่องที่ไม่มี `python3`
- **THEN** Runtime log บอกว่า `python3` ใช้ไม่ได้และไม่บันทึก path ของเจ้าของเครื่อง และ worker ยังขึ้น ready

### Requirement: Task log เขียนได้เฉพาะ supervisor
ภายใต้ sandbox ไม่มีคำสั่งหรือ tool ใดของ Agent เขียนหรือลบ Task log (`tasks.db`) ได้ การพยายามเขียน SHALL ล้มเหลวด้วย error ที่เห็นได้ Agent SHALL ยังอ่านประวัติ Task ของตัวเองได้ผ่าน supervisor supervisor SHALL เป็นผู้เดียวที่เขียน event ลง log และ MUST NOT เชื่อ event ที่ worker อ้างว่าเขียนแล้วโดยไม่บันทึกเอง (ADR 0018)

#### Scenario: คำสั่งเขียน log
- **WHEN** Agent รันคำสั่งใน sandbox ที่เขียนหรือลบ `tasks.db`
- **THEN** คำสั่งได้ error และ log ไม่เปลี่ยน

#### Scenario: tool เขียน log
- **WHEN** Agent ใช้ tool เขียนไฟล์ โดยตั้ง path เป็น `tasks.db`
- **THEN** tool ได้ error และ log ไม่เปลี่ยน

#### Scenario: อ่านประวัติของตัวเอง
- **WHEN** Agent เริ่ม Turn ใหม่และอ่านประวัติ Task ของตัวเอง
- **THEN** อ่านได้ตามปกติ

### Requirement: macOS เปิดเฉพาะ system service ที่ worker ต้องใช้
profile ของ macOS SHALL ระบุ `mach-lookup` เป็นรายชื่อ service ที่ worker และ toolchain ต้องใช้จริง MUST NOT เปิดทุก service ด้วย `(allow mach-lookup)` แบบไม่มีรายชื่อ คำขอไป service ที่ไม่อยู่ในรายชื่อ SHALL ถูกปฏิเสธและ SHALL เห็นได้ใน Runtime log รายชื่อที่อนุญาต SHALL มีเหตุผลกำกับว่ามาจาก worker, toolchain หรือ OS และ SHALL ระบุว่า service ของ Chromium ยังไม่อยู่ในรายการ

#### Scenario: service ที่อนุญาต
- **WHEN** worker รันหนึ่ง Turn ที่ใช้ `git` และ `bun` ใต้รายชื่อใหม่
- **THEN** worker ขึ้น ready และ Turn จบตามปกติ

#### Scenario: service ที่ไม่อยู่ในรายชื่อ
- **WHEN** worker ขอ service ที่ไม่อยู่ในรายชื่อ
- **THEN** คำขอถูกปฏิเสธและ Runtime log แสดงการปฏิเสธนั้น
