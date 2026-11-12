## Why

spec `runtime-sandbox` บอกว่า worker ทั้งตัวรันใน sandbox แต่โค้ดตอนนี้ครอบแค่คำสั่ง bash ทีละคำสั่ง tool อ่านเขียนไฟล์และ Memory จึงอยู่นอก sandbox และพึ่งการตรวจ path อย่างเดียว ส่วนคำสั่งก็อ่านได้ทั้งเครื่อง ยกเว้นรายชื่อไฟล์ลับ เช่น `cat ~/Develop/<โปรเจกต์>/.env` ได้ (ลองแล้วบน macOS 27) ADR 0068 และ 0069 ให้การอ่านเป็น allow-list และให้ครอบทั้ง worker นี่คือชิ้นแรกของ issue #32

## What Changes

- supervisor เปิด `veeloe worker` ใน sandbox ของ Agent ตัวนั้น: `sandbox-exec` บน macOS และ `bwrap` บน Linux tool ทุกตัวและคำสั่งลูกทุกตัวอยู่ใต้กฎชุดเดียว
- tool `bash` รันคำสั่งตรงๆ ไม่ครอบซ้ำ เพราะคำสั่งได้ sandbox ของ worker อยู่แล้ว และ Seatbelt ไม่ยอมให้ใส่ sandbox ซ้อน (ลองแล้ว: `sandbox_apply: Operation not permitted`)
- **BREAKING** การอ่านบน macOS เปลี่ยนจาก "อ่านได้ทั้งเครื่อง ยกเว้นไฟล์ลับ" เป็น allow-list: system path, toolchain, binary ของ Runtime และโฟลเดอร์ของ Agent เอง คำสั่งที่เคยอ่าน `~` หรือโปรเจกต์อื่นของเจ้าของจะได้ error จาก OS
- worker ได้ home จำลองที่ `<agent>/.home` (`HOME`, `XDG_CACHE_HOME` และ `GIT_CONFIG_GLOBAL` ที่มี identity ที่ Runtime สร้าง) แทน `HOME` ของเจ้าของเครื่อง cache ของ bun, npm และ git จึงอยู่ในโฟลเดอร์ของ Agent
- `veeloe worker` แยกโหมดก่อนแตะโฟลเดอร์ของ Runtime ไม่งั้นจะล้มด้วย EPERM เมื่ออยู่ใน sandbox
- เครื่องที่ทำ sandbox ไม่ได้ supervisor ไม่เปิด worker ตามที่ spec กำหนดไว้แล้ว

ยังไม่อยู่ในชิ้นนี้ (issue #32 ชิ้นถัดไป): ย้าย Task log ไปให้ supervisor เขียน, localhost ของ Agent เอง, proxy ต่อ Turn และ Egress ต่อ Agent, ทางออกเน็ตบน Linux, รายชื่อ mach-lookup และ cgroups ข้อแรกไม่ใช่การถอยหลัง เพราะวันนี้คำสั่งก็เขียน `tasks.db` ได้อยู่แล้ว

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `runtime-sandbox`: การอ่านเปลี่ยนจาก deny-list เป็น allow-list, เพิ่ม home จำลองของ Agent และบอกชัดว่า tool อ่านเขียนไฟล์อยู่ใต้ sandbox เดียวกับคำสั่ง

## Impact

- `runtime-core`: `Policy` และ profile ของ macOS (allow-list ของการอ่าน), argument ของ bwrap
- `runtime-supervisor`: การเปิด worker (wrap ด้วย sandbox, env ของ home จำลอง, สร้าง `.home/`), การแยกโหมด `worker` ก่อน `create_dir_all`
- `runtime-worker`: tool `bash` ไม่ครอบคำสั่งเอง
- test: test ที่รันคำสั่งใต้ sandbox จริงใน `runtime-supervisor` และ test ใหม่ที่เปิด worker ตัวจริงใต้ sandbox
- ผู้ใช้: Agent ที่เคยอ่านไฟล์นอกขอบเขตจะอ่านไม่ได้แล้ว ส่วนเครื่องมือที่อ่าน config จาก home จริง เช่น `~/.npmrc` หรือ `~/.gitconfig` จะไม่เห็นค่าของเจ้าของเครื่อง
