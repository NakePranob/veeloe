## MODIFIED Requirements

### Requirement: worker ทุกตัวรันใน sandbox ของ OS
supervisor SHALL เปิด worker ของทุก Agent ภายใน sandbox ของ OS ที่ครอบทั้งโปรเซส worker และทุกโปรเซสลูกของมัน supervisor MUST NOT เปิด worker นอก sandbox ไม่ว่ากรณีใด กฎของ sandbox SHALL เป็นของ Agent ตัวนั้นเอง และ worker SHALL คุยกับ supervisor ได้ทางช่อง IPC ของตัวเองเท่านั้น tool ทุกตัวของ worker รวมถึง tool อ่านเขียนไฟล์และ Memory SHALL อยู่ใต้ sandbox เดียวกับคำสั่ง bash การตรวจ path ของ tool เป็นชั้นสำรอง ไม่ใช่กำแพงเพียงชั้นเดียว

#### Scenario: เปิด worker
- **WHEN** supervisor เปิด worker ของ Agent ตอนเริ่มหรือตอนสร้าง Agent ใหม่
- **THEN** worker และคำสั่งทุกตัวที่ worker รันอยู่ใต้ sandbox และ worker ยังรับข้อความกับส่ง event ผ่าน IPC ได้ตามปกติ

#### Scenario: worker พังแล้วเปิดใหม่
- **WHEN** worker จบเองแล้ว supervisor เปิดใหม่
- **THEN** worker ตัวใหม่อยู่ใต้ sandbox ด้วยกฎเดิม

#### Scenario: tool อ่านไฟล์ผ่าน symlink ที่ชี้ออกนอก
- **WHEN** Agent สร้าง symlink ใน Workdir ที่ชี้ไปไฟล์ใน home ของเจ้าของเครื่อง แล้วใช้ tool `read` อ่านผ่าน symlink นั้น
- **THEN** tool ได้ error และ LLM ไม่ได้เนื้อหาของไฟล์

### Requirement: Agent อ่านโฟลเดอร์ของ Runtime และไฟล์ลับไม่ได้
ภายใต้ sandbox worker SHALL อ่านได้เฉพาะ path ที่ Runtime เปิดให้: path ระบบที่โปรแกรมต้องใช้ (เช่น `/usr`, `/bin`, `/System`, `/dev`, `/etc`), toolchain ที่ติดตั้งในที่มาตรฐานของ OS (เช่น Command Line Tools, Xcode และ Homebrew บน macOS), binary ของ Runtime และโฟลเดอร์ของ Agent ตัวเอง ทั้งหมดนอกจากโฟลเดอร์ของ Agent SHALL อ่านได้อย่างเดียว worker MUST NOT อ่าน home ของเจ้าของเครื่อง, `<VEELOE_HOME>` นอกจากโฟลเดอร์ของตัวเอง ซึ่งรวมถึงกุญแจของ Machine, `runtime/` และโฟลเดอร์ของ Agent ตัวอื่น และ path อื่นที่ไม่ได้เปิดไว้ แม้เป็น Turn ของ Owner และแม้คำสั่งได้ Approval แล้ว การอ่านผ่าน symlink หรือ hard link SHALL ได้ผลเดียวกับการอ่านตรง (ADR 0068, 0069)

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

#### Scenario: อ่านไฟล์ทั่วไป
- **WHEN** Agent อ่านไฟล์ระบบที่อยู่ใน path ที่เปิดไว้ เช่น `/etc/hosts`
- **THEN** อ่านได้

## ADDED Requirements

### Requirement: Agent มี home ของตัวเอง
worker SHALL ได้ home ของตัวเองที่ `.home/` ในโฟลเดอร์ของ Agent ซึ่ง Runtime สร้างให้ `HOME` และที่เก็บ cache มาตรฐานของ worker และคำสั่งทุกตัว SHALL ชี้มาที่นี่ Runtime SHALL ให้ git config ส่วนกลางของ Agent ที่มีชื่อและอีเมลที่ Runtime ตั้ง และ MUST NOT ส่ง config, credential หรือ SSH key จาก home ของเจ้าของเครื่องเข้ามา ไฟล์ใน `.home/` SHALL อยู่ข้าม Turn และข้ามการเปิด worker ใหม่

#### Scenario: HOME ของคำสั่ง
- **WHEN** Agent รัน `echo $HOME`
- **THEN** ได้ path ของ `.home/` ในโฟลเดอร์ของ Agent ไม่ใช่ home ของเจ้าของเครื่อง

#### Scenario: commit ใน Workdir
- **WHEN** Agent รัน `git init` แล้ว `git commit` ใน Workdir
- **THEN** commit สำเร็จด้วยชื่อและอีเมลที่ Runtime ตั้ง และไม่ได้อ่าน `~/.gitconfig` ของเจ้าของ

#### Scenario: cache อยู่ข้ามการเปิด worker ใหม่
- **WHEN** Agent เขียนไฟล์ลง `$HOME` แล้ว worker ถูกเปิดใหม่
- **THEN** ไฟล์นั้นยังอยู่
