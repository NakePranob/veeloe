# runtime-sandbox Specification

## Purpose

กำหนดว่า worker ของ Agent ทุกตัวรันใน sandbox ระดับ OS อย่างไร อ่าน เขียน และออกเน็ตได้แค่ไหน เพื่อให้คำสั่งที่ Agent รัน รวมถึงโปรแกรมลูกที่คำสั่งนั้นเรียก อยู่ใต้กฎชุดเดียวที่ OS บังคับ (ADR 0008, 0032)

## Requirements

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

### Requirement: Agent รัน service ของตัวเองบน localhost
Agent SHALL มี localhost ของตัวเองไว้รัน dev server, Postgres, Redis และ headless browser โดยไม่ชนกับ Agent อื่น บน Linux worker SHALL อยู่ใน network namespace ที่มี loopback ของตัวเอง (bwrap เปิด `lo` ให้) และคำสั่งลูกทั้งหมด SHALL ใช้ namespace เดียวกัน service ที่คำสั่งเริ่ม SHALL อยู่ข้าม Turn ตราบที่ worker ยังอยู่ บน macOS supervisor SHALL จองช่วง port คงที่ต่อ Agent (10 port) เก็บไว้นอกโฟลเดอร์ที่ Agent เขียนได้ รอด restart และ MUST NOT ให้สอง Agent ใช้ช่วงเดียวกัน profile SHALL เปิด network เข้าและออกเฉพาะ port ในช่วงนั้น บวก port ของ proxy worker SHALL ได้ `PORT` เป็น port แรกและ `VEELOE_PORTS` เป็นรายชื่อ port ทั้งช่วง

#### Scenario: dev server ของตัวเอง
- **WHEN** Agent รัน dev server ที่ผูกกับ `PORT` แล้ว `curl http://127.0.0.1:$PORT`
- **THEN** ต่อได้ทั้ง macOS และ Linux

#### Scenario: service สองตัวบน Linux
- **WHEN** Agent สองตัวรัน service ที่ใช้เลข port เดียวกัน
- **THEN** ทั้งคู่ทำงานได้ เพราะคนละ network namespace

#### Scenario: port คงที่หลัง restart
- **WHEN** worker ถูกเปิดใหม่
- **THEN** Agent ได้ช่วง port เดิมและ service ที่เคยผูกไว้ใช้ค่าเดิม

#### Scenario: service ของเจ้าของเครื่อง
- **WHEN** Agent ต่อ service ที่เจ้าของเครื่องเปิดไว้นอกช่วง port ของ Agent
- **THEN** การเชื่อมต่อถูกปฏิเสธ
