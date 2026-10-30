# Runtime สร้าง Workdir เองในโฟลเดอร์ของ Runtime และ Member เลือกที่อยู่ไม่ได้

sandbox ปล่อยให้ Agent เขียนอะไรก็ได้ใน Workdir (ADR 0008) ถ้า Member เลือก path เองได้ตามแผนเดิม จะหลุด sandbox ได้หลายทาง ตั้ง Workdir เป็น `$HOME` แล้ว Agent เขียน `~/.zshrc` หรือ `~/Library/LaunchAgents` ซึ่งรันนอก sandbox ตอนเจ้าของเปิดเทอร์มินัลหรือ login ครั้งต่อไป ตั้งให้ครอบไฟล์ของ Runtime แล้ว Agent แก้รายชื่อกุญแจที่ไว้ใจหรือเปลี่ยน binary ได้ ตั้งสอง Agent ให้ซ้อนกันแล้วกฎคนเขียนคนเดียวของ ADR 0011 หลุด และ Agent ตัวหนึ่งอ่าน Workdir ของอีกตัวได้ เราจึงให้ Runtime สร้าง Workdir เองที่ `<VEELOE_HOME>/agents/<agent-id>/workdir` โดย `VEELOE_HOME` เป็นโฟลเดอร์ของ Runtime ที่มีอยู่แล้ว (ค่าเริ่มต้น `~/.veeloe`) Member เลือกที่อยู่เองไม่ได้ ถ้าจะทำงานกับ repo ที่มีอยู่แล้ว ให้ Agent clone เข้ามา แล้วส่งงานกลับด้วย git แบบเดียวกับ Agent ที่ทำงานร่วมกันนอก Project หรือใช้ repo ของ Project (ADR 0047)

```
~/.veeloe/
├── config.json, กุญแจของ Machine
├── runtime/             ของ supervisor: รายชื่อกุญแจที่ไว้ใจ, เลขกันส่งซ้ำ, SQLite, credential ของ Connector (ADR 0039)
├── bin/                 binary ที่ updater เปลี่ยน (ADR 0009)
├── libraries/<id>/      Library (ADR 0037)
├── projects/<id>/       repo, worktree และโฟลเดอร์ของ Task ของ Project (ADR 0047)
└── agents/<agent-id>/
    ├── workdir/         Workdir ซึ่งมี MEMORY.md อยู่ที่ root (ADR 0036)
    ├── skills/          Skill ที่ Member ติดตั้ง Agent อ่านได้อย่างเดียว (ADR 0038)
    ├── tasks.db         SQLite ของ worker (ADR 0020)
    └── tmp/             TMPDIR ของ worker (ADR 0008)
```

สิทธิ์แบบเจ้าของเข้าได้คนเดียวของ `~/.veeloe` กัน Agent ไม่ได้ เพราะ worker ใช้ OS user เดียวกับเจ้าของเครื่อง (ADR 0020) sandbox ของ worker จึงต้องห้ามทั้งอ่านและเขียนทุกอย่างใน `~/.veeloe` ยกเว้นโฟลเดอร์ของ Agent ตัวนั้น ซึ่งในนั้น `skills/` อ่านได้อย่างเดียว ยกเว้นการอ่าน Workdir ของพนักงานร่วม Project ระหว่างทำ Task ของ Project (ADR 0026) ยกเว้น Library ที่ได้สิทธิ์อ่านหรือเขียน (ADR 0037) และยกเว้น repo, worktree หรือโฟลเดอร์ของ Task ที่ Turn นั้นทำงานอยู่ (ADR 0047) `tasks.db` กับ `tmp/` อยู่ข้าง Workdir ไม่ได้อยู่ข้างใน เพื่อไม่ให้ `git clean` หรือ `rm -rf *` ใน Workdir ลบประวัติ Task ทิ้งโดยไม่ตั้งใจ ชื่อโฟลเดอร์ใช้ id ของ Agent จึงเปลี่ยนชื่อ Agent ได้โดยไม่ต้องย้ายโฟลเดอร์

## Considered Options

- **Member เลือก path เอง แล้ว Runtime ตรวจว่าไม่ใช่ `$HOME` ไม่ซ้อนกับ Workdir อื่น ไม่ครอบไฟล์ของ Runtime และไม่ใช่โฟลเดอร์ของระบบ**: ชี้ Agent ไปที่โฟลเดอร์งานที่มีอยู่ได้ทันที แต่เป็นรายการห้ามที่ต้องเพิ่มไปเรื่อยๆ พลาดกรณีเดียวก็หลุด sandbox และคนจะชี้ไปที่ repo ที่ใช้ทุกวัน ซึ่ง Agent เขียน `.git/hooks` ให้ไปรันตอนเจ้าของรัน git ในเทอร์มินัลได้

## Consequences

- โค้ดที่ Agent เขียนไว้ใน Workdir ยังรันนอก sandbox ได้ ถ้าเจ้าของเครื่องเปิด Workdir แล้วรันคำสั่งในนั้นเอง เช่น `git checkout` ที่ไปเรียก hook หรือ `npm test` ที่ไปเรียก script ที่ Agent แก้ไว้ แอปต้องเตือนเรื่องนี้ แต่งานปกติจะไม่ปนกับโฟลเดอร์ที่เจ้าของใช้ทุกวัน
- `.veeloe` เป็นโฟลเดอร์ซ่อน คนที่อยากดูไฟล์ที่ Agent ทำต้อง `cd` เข้าไปเอง แบบเดียวกับ `~/.claude`, `~/.openclaw` และ `~/.hermes`
- โฟลเดอร์ของ Agent ที่ถูกลบ หรือของ Workspace เดิมหลังเลิกผูก ยังอยู่บนดิสก์จนกว่าเจ้าของจะลบเอง เพราะเป็นข้อมูลของลูกค้า (ADR 0024) และ Agent ตัวอื่นอ่านไม่ได้
