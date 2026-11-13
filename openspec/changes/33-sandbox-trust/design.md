## Context

ต่อจาก change `32-sandbox-whole-worker` ที่ครอบ worker ทั้งตัวใน sandbox แล้ว (merge เข้า `develop` ที่ `008766b`) สภาพที่เหลือ:

- `sandbox_exec_profile` เปิด `(allow mach-lookup)` ทั้งหมด และ allow-list ของการอ่านเขียนด้วยมือ
- worker เปิด `EventStore` ที่ `<agent>/tasks.db` แล้วเขียนเองทุก event (`State::append` ใน `runtime-core` ส่ง `FromWorker::Event` ให้ supervisor ด้วย แต่ supervisor แค่วิ่งต่อไป Hub)
- supervisor เปิด worker ผ่าน `workers::sandboxed` และไม่มีขั้นตอนตรวจ toolchain
- workflow ทั้งหมดรันบน `ubuntu-latest`; มีเพียง job `runtime-macos` ที่เพิ่มใน PR #38
- bug ของ framework toolchain: `system_files_and_toolchains_still_work` ล้มบนเครื่องที่ `python3` มาจาก `/Library/Frameworks/Python.framework` (แก้ allow-list แล้วใน PR #38)

## Goals / Non-Goals

**Goals:**
- allow-list ครอบ toolchain ทุก layout มาตรฐาน และ Runtime บอก toolchain ที่ใช้ไม่ได้ตอนเปิด worker
- Task log เขียนได้โดย supervisor เท่านั้น และ Agent ยังอ่านประวัติของตัวเองได้
- `mach-lookup` เป็นรายชื่อ service ขั้นต่ำพร้อมเหตุผล
- test ใต้ `sandbox-exec` จริงรันบน macOS ใน CI

**Non-Goals:**
- localhost ของ Agent, ทางออกเน็ตบน Linux, proxy ต่อ Turn, Egress ต่อ Agent, git broker, cgroups/RLIMIT, AppArmor (ชิ้นถัดไปของ issue #32)
- mach-lookup ของ Chromium และ headless browser
- Windows และ WSL2
- เปลี่ยนจาก `sandbox-exec` ไป API อื่นของ macOS

## Decisions

**allow-list ของ toolchain เป็นรายชื่อ path มาตรฐาน ไม่ใช่การไล่ทั้งเครื่อง:** เพิ่ม `/Library/Frameworks` และ `/Library/Python` แบบอ่านอย่างเดียว หลักเดิมยังอยู่: สิ่งที่ไม่เปิดไว้มองไม่เห็น และ test ต้องพิสูจน์ layout ได้โดยไม่ผูกกับว่าเครื่องที่รันมี Python ตัวไหน

**self-check ตอนเปิด worker เป็นข้อมูล ไม่ใช่ fail closed:** supervisor รันคำสั่งสั้น ๆ ของ `git`, `python3`, `node`, `bun` ใต้ policy เดียวกับ worker แล้วบันทึกผลระดับ Runtime เป็นชื่อ tool กับผลเท่านั้น ไม่มี path หรือเนื้อหาไฟล์ของผู้ใช้ ตัวที่ขาดไม่ทำให้ worker ไม่เปิด ต่างจากกรณี sandbox เริ่มไม่ได้ซึ่งยัง fail closed ตาม ADR 0069

**supervisor เป็นเจ้าของการเขียน Task log:** worker ส่ง event ผ่าน stdio ที่มีอยู่แล้ว supervisor เป็นผู้เรียก `EventStore::append` และเป็นผู้เดียวที่เปิดไฟล์เพื่อเขียน ต้องเพิ่ม event ใน protocol ระหว่าง supervisor กับ worker เพื่อให้ worker รู้ event ที่ถูกบันทึกแล้ว (ลำดับและเวลา) ก่อนส่งต่อให้ LLM หรือ Controller

**log อยู่นอกส่วนที่คำสั่งเขียนได้:** ไม่แก้ที่ตัว tool ทีละตัว แต่ทำให้ path ของ log ถูกปฏิเสธการเขียนจาก sandbox ทั้ง macOS และ Linux คำสั่งและ tool ทุกตัวจึงอยู่ใต้กฎเดียวกันจริง และยังอ่านได้เพื่อประวัติของ Task

**ย้าย log ของ Agent เดิมตอนเปิด worker ครั้งแรกหลังอัปเดต:** ประวัติต้องไม่หายและ Owner ไม่ต้องทำอะไร

**mach-lookup เป็นรายชื่อขั้นต่ำ:** เริ่มจาก service ที่ worker, `git`, `bun` และ `node` ต้องใช้จริง แล้วเพิ่มเป็นรายตัวเมื่อ Runtime log แสดงว่าถูกปฏิเสธ ไม่มี service ใดถูกเพิ่มโดยไม่มีหลักฐาน

**CI macOS job แยกและเบา:** `runtime-macos` รันเฉพาะ test ของ Runtime ที่ต้องมี `sandbox-exec` จริง ไม่พึ่ง Docker, Postgres หรือเครือข่าย และไม่ถูกข้ามเมื่อเครื่องขาดของ

## Risks / Trade-offs

- [macOS runner แพงกว่า Linux และยังไม่มี cache] → job รันเฉพาะ test ที่ต้องใช้ sandbox จริง
- [การย้ายการเขียน log แตะ protocol และอาจทำให้ event ตกหล่นถ้า supervisor ไม่ตอบ] → worker ต้องไม่ถือว่า event ถูกบันทึกก่อนได้รับการยืนยัน และต้องมี test ที่ worker ตายกลาง Turn แล้ว event ก่อนตายยังอยู่
- [mach-lookup ที่แคบเกินทำให้ toolchain พัง] → self-check ของ toolchain ต้องมาก่อน และการปฏิเสธต้องเห็นได้ใน Runtime log
- [path ของ macOS เปลี่ยนตามรุ่น] → test ใต้ `sandbox-exec` จริงใน CI ทำให้ build แดงแทนที่จะพังเงียบ

## Migration Plan

- Agent ที่มี `tasks.db` อยู่แล้ว: supervisor ย้ายหรือเปิด log เดิมให้ต่อเนื่องตอนเปิด worker ครั้งแรกหลังอัปเดต ไม่ต้องให้ Owner ทำอะไร
- ไม่มีข้อมูลอื่นต้องย้าย; การถอยกลับทำได้ด้วยการลง release ก่อนหน้า
