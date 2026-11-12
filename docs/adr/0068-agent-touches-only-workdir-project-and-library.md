# Agent แตะไฟล์ได้เฉพาะ Workdir, Project ที่ได้งาน และ Library ตามสิทธิ์

ทุก Turn ของ Agent ควรแตะได้แค่สามที่: **Workdir ของตัวเอง**, **Project ที่ Task นี้ทำงานอยู่** และ **Library ที่ได้รับสิทธิ์** — ที่อื่นincluding home ของผู้ใช้ต้องถูกปฏิเสธโดย OS ไม่ใช่โดยคำสั่งใน prompt หรือการกดอนุมัติ เพราะ Approval กับ Allowlist เป็นนโยบาย "จะถามคนไหม" ไม่ได้ให้สิทธิ์ไฟล์ (ADR 0008, 0030)

ที่มาคือเคสจริง: Owner อนุมัติ `ls ~` แล้ว Agent เห็นรายชื่อโฟลเดอร์ใน home (แม้ `.ssh`, `.aws`, `.veeloe` จะถูกบล็อก) และก่อนหน้านั้น Memory reader อ่านผ่าน symlink ออกนอก Workdir ได้ เพราะการอ่านไม่ได้ confine เท่าการเขียน — การป้องกันต้องอยู่ที่ sandbox และ path resolver ของ tool ไม่ใช่ที่ harness

ขอบเขตต่อ Turn:

- **อ่าน+เขียน**: Workdir ของ Agent; Project repo/worktree เฉพาะเมื่อ Task นี้ทำงานใน Project นั้น (ADR 0047)
- **อ่าน**: Library ที่ Agent ได้รับสิทธิ์ และ system paths ที่จำเป็น (`/usr`, `/bin`, `/System`, SDK) — เขียนไม่ได้
- **เขียน Library**: เฉพาะ Agent ที่เป็น writer คนเดียวของ Library นั้น; Project wiki ตั้ง Entry เป็น writer โดยค่าเริ่มต้น (ADR 0037, 0064)
- **ปฏิเสธเสมอ**: home จริง, `VEELOE_HOME`, secret paths, docker socket, path นอกขอบเขตข้างต้น — แม้เป็น Turn ของ Owner

เพื่อให้ toolchain ใช้งานได้: worker ใช้ **home จำลองใน Workdir** (`<workdir>/.home`) เป็น `HOME`/`XDG_CACHE_HOME`/`CARGO_HOME`/`npm`/`bun`/Playwright cache, `TMPDIR` ของ Agent, และ git identity ที่ Runtime สร้างให้ (`GIT_CONFIG_GLOBAL`) — ไม่มี SSH key หรือ config ส่วนตัวจาก home จริง; remote ใช้ HTTPS/Connector

สถานะโค้ด: ยังไม่ได้ลง allow-list profile ตาม ADR นี้; โค้ดปัจจุบันยังใช้ profile แบบเดิมที่อ่านได้กว้างแล้ว deny secret (deny-list) เพราะ allow-list แบบ `subpath` ทำให้ `sandbox-exec` บน macOS 27 abort (exit 134) ระหว่างทดลอง — ต้องแก้ backend/workaround ก่อนจึงจะถือว่าสัญญานี้ถูกบังคับจริง; file/memory tools confine path แล้ว และ **worker ทั้งโปรเซสยังไม่ถูก wrap** เพราะ Rust binary abort ใต้ `sandbox-exec` (บันทึกใน `main.rs`) เป้าหมายตาม ADR 0008 คือ wrap ทั้ง worker เมื่อแก้ข้อจำกัดนั้นได้ (ปิดช่อง TOCTOU ระหว่าง resolve กับ open)

## Considered Options

- **ให้ Owner เพิ่ม read root เอง (เช่น `~/Development`)**: ยืดหยุ่น แต่เปิด path picker เมื่อไร sandbox ก็กลับไปหลวมและคนจะอนุมัติผ่าน; ทางที่ถูกคือ import/clone เข้า Project
- **พึ่ง Approval/Allowlist อย่างเดียว**: กัน `ls ~` หรือ `npm test` ที่แอบอ่าน secret ไม่ได้ (ADR 0008)
- **Docker ต่อ Agent**: แยกขาดแต่ผู้ใช้ต้องมี Docker และ Agent แตะ tool จริงบนเครื่องได้ยาก
- **ให้สิทธิ์ตาม Grant ของ Member (Manage อ่านได้ทุกไฟล์)**: ง่ายต่อความเข้าใจผิด แต่ทำให้ Owner Turn เป็นช่องอ่าน home ทั้งเครื่อง; Grant ควรคุมค่า Agent ไม่ใช่ขอบเขตไฟล์

## Consequences

- `bun install`, `cargo build`, `npm test` ใช้ได้ผ่าน home จำลอง; `brew install`, `npm i -g`, `gh`, `aws`, `docker`, SSH ใช้ไม่ได้ (ตั้งใจ)
- Project Turn ที่ใช้ worktree ทำให้ Workdir อ่านอย่างเดียว; Memory tool/flush ต้องข้ามหรือเข้าคิว (ADR 0047)
- Library ต้องมีสิทธิ์ราย Agent ต่อ Library และ Runtime ต้องสร้าง roots ใหม่ทุก Turn; ถอนสิทธิ์แล้วรอบถัดไปต้องไม่เห็น
- ต้องมี audit ของ path ที่ถูกปฏิเสธ (ไม่มีเนื้อหา) เพื่อ debug และตรวจการพยายามเข้าถึง
- ADR 0008 ยังเป็นเป้าหมาย (sandbox ครอบทั้ง worker); ระหว่างที่ยังทำไม่ได้ การป้องกันทาง tool ถือเป็นส่วนหนึ่งของสัญญา ไม่ใช่แค่ความสะดวก
