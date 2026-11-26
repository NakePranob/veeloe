## Context

ดู proposal.md ส่วน Why สภาพโค้ดตอนนี้:

- supervisor เปิด worker ผ่าน closure `wrap` ที่แค่ต่อ `--proxy <url>` ท้ายคำสั่ง แล้ว spawn ตรงๆ ด้วย env `HOME` ของเจ้าของเครื่อง
- worker สร้าง `Sandbox` จาก `Config::sandbox()` แล้วส่งให้ `BashTool` ซึ่งครอบทุกคำสั่งด้วย `sandbox-exec -p <profile>` หรือ `bwrap ... --`
- profile ของ macOS คือ `(allow file-read*)` แล้ว `deny` โฟลเดอร์ของ Runtime กับ `SECRET_PATHS` ส่วน Linux `bwrap` bind แค่ `/usr /bin /lib /lib64`, bin และโฟลเดอร์ของ Agent จึงเป็น allow-list อยู่แล้ว
- เหตุผลใน `main.rs` ที่ไม่ครอบ worker คือ Rust binary abort ใต้ `sandbox-exec` ("failed to allocate a guard page") ระหว่างทำ issue #32 ผมลองบน macOS 27 แล้ว `veeloe worker` ขึ้น `{"kind":"ready"}` ได้ทั้งกับ profile เดิมและ allow-list ที่มี path ระบบครบ (ADR 0069)
- `veeloe` เรียก `create_dir_all(runtime_home())` ก่อน dispatch ไปโหมด `worker` เมื่อโฟลเดอร์ของ Runtime ถูกกันไว้ ขั้นนี้ได้ EPERM

## Goals / Non-Goals

**Goals:**
- ครอบ worker ทั้งตัวบน macOS และ Linux ด้วย policy ที่สร้างใน supervisor
- allow-list ของการอ่านบน macOS และ home จำลองบนทั้งสองระบบ

**Non-Goals:**
- ย้าย Task log, localhost ต่อ Agent, proxy ต่อ Turn, ทางออกเน็ตบน Linux, mach-lookup allowlist, cgroups (ชิ้นถัดไปของ #32)
- เปลี่ยนกฎเน็ต: macOS ยังเปิดแค่ port ของ proxy ส่วน Linux ยังไม่มีเน็ต

## Decisions

**supervisor เป็นคนสร้าง policy และครอบ worker:** `wrap` ใน `main.rs` สร้าง `Policy` จาก Agent (โฟลเดอร์, bin ของ `current_exe`, home จริงที่ต้องกัน, `VEELOE_HOME`, Egress, port ของ proxy) แล้วคืน `Sandbox::wrap(command)` worker เองไม่สร้าง sandbox อีก ทางอื่นที่พิจารณาคือให้ worker เรียก `sandbox_init` กับตัวเองหลังเริ่ม (Chromium ทำแบบนี้) ซึ่งไม่ต้องใช้ แต่เก็บไว้เป็นทางสำรองถ้าครบหนึ่ง Turn แล้วเจอ abort

**`BashTool` ไม่ครอบคำสั่ง:** ใช้ `Sandbox` แบบไม่มีกฎ (คืน argv ตามเดิม) แทนการลบ field ออก เพื่อให้ test เดิมที่ใช้ `BashTool` ตรงๆ ยังใส่ sandbox เองได้ ทางอื่นคือให้ bash ครอบซ้อน ซึ่ง Seatbelt ไม่ยอม

**allow-list บน macOS:** หลัง `(deny default)` เปิด `file-read-metadata` ทั้งหมด (ให้ `stat` เดินทาง path ได้ แต่ไม่ได้เนื้อหาหรือรายชื่อในโฟลเดอร์) แล้ว `file-read*` สำหรับ `/` แบบ literal, `/usr`, `/bin`, `/sbin`, `/System`, `/Library/Apple`, `/Library/Preferences`, `/Library/Developer/CommandLineTools`, `/Applications/Xcode.app`, `/private/etc`, `/private/var/db/dyld`, `/private/var/db/timezone`, `/private/var/select`, `/dev`, `/opt/homebrew`, `/usr/local`, bin ของ Runtime และโฟลเดอร์ของ Agent ไม่ต้องมีรายชื่อไฟล์ลับอีก ชุดนี้ลองแล้วว่า worker, `git`, `python3`, `bun` ทำงานได้ และ `ls ~` ได้ EPERM ข้อเสียของ `file-read-metadata` ทั้งหมดคือ Agent รู้ได้ว่ามี path ไหนอยู่บ้างถ้าเดาชื่อถูก ซึ่งรับได้ในชิ้นนี้

**Linux คง bind ชุดเดิม แล้วเพิ่ม `/etc` แบบอ่านอย่างเดียวกับ `/sbin`:** `git` และ `python3` ต้องอ่าน `/etc` และไม่ต้องใส่ `deny_read` แบบ `/dev/null` ทับอีก เพราะ path ที่ไม่ได้ bind มองไม่เห็นอยู่แล้ว ขั้นนี้ต้องลองใน Docker แบบเดียวกับที่ลองทางออกเน็ต

**home จำลอง:** supervisor สร้าง `<agent>/.home/` และ `.home/.gitconfig` ที่มี `user.name = <ชื่อ Agent>` และ `user.email = <agent-id>@agents.veeloe.invalid` ถ้ายังไม่มี แล้วส่ง `HOME`, `XDG_CACHE_HOME=<.home>/.cache` และ `GIT_CONFIG_GLOBAL` ให้ worker `.home` อยู่ในโฟลเดอร์ของ Agent จึงเขียนได้ตามกฎเดิม ส่วน `.gitconfig` ตั้งใหม่ทุกครั้งที่เปิด worker จะดีกว่าไหม: ไม่ เพราะ Agent อาจตั้งค่า git ของตัวเองไว้

**แยกโหมด `worker` ก่อน `create_dir_all`:** ย้ายการ match `worker` ขึ้นไปก่อนสร้างโฟลเดอร์ของ Runtime

**fail closed:** `wrap_for` บนระบบอื่นนอกจาก macOS กับ Linux คืน argv ตามเดิม จึงต้องให้ supervisor ปฏิเสธการเปิด worker บนระบบเหล่านั้น บน Linux ที่ไม่มี `bwrap` การ spawn ล้มเองอยู่แล้ว และ supervisor ต้องรายงาน "could not start" ตามเดิม

## Risks / Trade-offs

- [ระหว่างทำพบว่าบน Linux `wrap_for` ไม่ได้ใส่ `bwrap` นำหน้า argv มาตั้งแต่ก่อน change นี้ คำสั่งบน Linux จึงเริ่มไม่ได้เลย และ test เดิมตรวจแค่ข้อความ จึงไม่จับ] → แก้แล้ว และ test ใต้ sandbox จริงรันบน Linux ด้วย

- [Rust worker อาจ abort ใต้ sandbox ระหว่าง Turn จริง แม้ตอนเริ่มจะผ่าน] → test ใหม่ต้องให้ worker รันครบหนึ่ง Turn ที่เรียก tool และถ้าพังให้ลองทาง `sandbox_init`
- [toolchain ที่อยู่นอก allow-list จะใช้ไม่ได้ เช่น asdf/mise/nvm ใน home ของเจ้าของ] → บอกไว้ใน proposal; ทางแก้คือให้ Agent ติดตั้งใน `.home/` ของตัวเอง
- [macOS รุ่นใหม่ย้าย path ระบบ] → test ที่รันใต้ sandbox จริงอยู่ใน CI บน macOS
- [คำสั่งยังเขียน `tasks.db` ได้] → เหมือนวันนี้ แก้ในชิ้นถัดไป

## Migration Plan

ไม่มีข้อมูลต้องย้าย worker ที่เปิดหลังอัปเดตจะได้ `.home/` ใหม่และกฎใหม่เอง ถอยกลับได้ด้วยการลง release ก่อนหน้า
