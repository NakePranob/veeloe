## 1. กฎของ sandbox

- [x] 1.1 เปลี่ยน profile ของ macOS ใน `runtime-core` เป็น allow-list ตาม design.md แล้วเอา `SECRET_PATHS` กับ `deny_read` ออกจาก profile ตรวจด้วย test ใต้ sandbox จริงใน `runtime-supervisor`: `ls ~` และ `cat <VEELOE_HOME>/runtime/...` ได้ error, `/etc/hosts` อ่านได้, `git --version` และ `python3` ทำงาน
- [x] 1.2 เพิ่ม `/etc` และ `/sbin` แบบอ่านอย่างเดียวในการ bind ของ `bwrap` และเลิก bind `/dev/null` ทับ path ที่ห้าม ตรวจด้วย test เดียวกันบน Linux (CI หรือ Docker)
- [x] 1.3 ปรับ test เดิมที่ตรวจข้อความของ profile ให้ตรวจพฤติกรรมแทนตาม ADR 0022 และให้ `cargo test -p veeloe-runtime-supervisor --test sandbox` ผ่าน

## 2. ครอบ worker ทั้งตัว

- [x] 2.1 แยกโหมด `worker` ใน `main.rs` ก่อน `create_dir_all(runtime_home())` ตรวจว่า `veeloe worker` ใต้ sandbox ที่กัน `VEELOE_HOME` ขึ้น `ready`
- [x] 2.2 ให้ `wrap` ของ supervisor สร้าง `Policy` ของ Agent แล้วครอบ worker ด้วย `Sandbox::wrap` และปฏิเสธการเปิด worker บนระบบที่ไม่มี sandbox ตรวจด้วย test ของ `workers` ว่า argv ขึ้นต้นด้วย `sandbox-exec` หรือ `bwrap`
- [x] 2.3 ให้ `BashTool` ที่ worker สร้างใช้ `Sandbox` แบบไม่มีกฎ และอัปเดตความเห็นใน `main.rs` กับ `bash.rs` ที่อ้างเรื่อง guard page ตรวจด้วย test ของ `bash` ใน `runtime-worker`

## 3. home จำลอง

- [x] 3.1 ให้ supervisor สร้าง `<agent>/.home/` และ `.home/.gitconfig` (ถ้ายังไม่มี) แล้วส่ง `HOME`, `XDG_CACHE_HOME`, `GIT_CONFIG_GLOBAL` ให้ worker แทน `HOME` จริง ตรวจด้วย test ที่ `echo $HOME` ใน bash ได้ `.home/` และ `git commit` ใน Workdir สำเร็จ

## 4. ตรวจทั้งระบบ

- [x] 4.1 เพิ่ม test ที่เปิด binary `veeloe` จริงเป็น worker ผ่าน supervisor ใต้ sandbox ใน `VEELOE_HOME` ชั่วคราว แล้วให้ worker รันหนึ่ง Turn กับ Provider จำลองที่เรียก `bash` (`cat ~/...` ได้ error, เขียน Workdir ได้) และ `read` ผ่าน symlink ที่ชี้ออกนอก (ได้ error) ตรวจด้วย `cargo test`
- [x] 4.2 รัน `bun run check`, `bun run test` และ `bun run test:e2e` แล้วสั่ง Agent ผ่าน Hub API และ Runtime ตัวจริงด้วยโค้ด pairing กับ hub client ของ Controller: `ls /Users/<owner>` ได้ `Operation not permitted` แม้อนุมัติแล้ว, `$HOME` เป็น `.home/` ของ Agent และ `bun --version` ได้ `1.3.14` (`check` และ `test` ผ่าน; `agent-task.test.ts` ใน e2e ล้มเท่ากันทั้งก่อนและหลัง change นี้; ยังไม่ได้กดผ่าน UI ของแอป)
- [x] 4.3 archive change นี้พร้อม merge spec delta เข้า `openspec/specs/runtime-sandbox/` แล้วแสดงความคืบหน้าใน issue #32
