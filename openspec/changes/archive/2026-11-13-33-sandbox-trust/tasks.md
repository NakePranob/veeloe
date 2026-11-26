## 1. test ใต้ sandbox จริงบน macOS ใน CI (#34)

- [x] 1.1 job `runtime-macos` รัน test ที่เปิดคำสั่งใต้ `sandbox-exec` จริงและ test ที่เปิด worker ตัวจริงผ่าน supervisor แล้วรันหนึ่ง Turn
- [x] 1.2 job ไม่พึ่ง Docker, Postgres หรือเครือข่าย และไม่ถูกข้ามด้วยเหตุผลว่าขาดของ
- [x] 1.3 พิสูจน์ red/green ด้วยการเอา path ที่ toolchain ต้องใช้ ออกจาก allow-list ชั่วคราวแล้วย้อนกลับ (บันทึกไว้ใน PR #38)
- [x] 1.4 job ของ Linux ยังทำงานเหมือนเดิมและไม่รัน test ชุดนี้ซ้ำ

## 2. toolchain ของ Agent (#35)

- [x] 2.1 allow-list ของ macOS ครอบ framework-style toolchain (`/Library/Frameworks`, `/Library/Python`) และ Homebrew ยังใช้ได้
- [x] 2.2 supervisor ตรวจ `git`, `python3`, `node`, `bun` ใต้ policy เดียวกับ worker ตอนเปิด worker และบันทึกผลระดับ Runtime เป็นชื่อกับผลเท่านั้น ไม่มี path หรือเนื้อหาไฟล์ของผู้ใช้
- [x] 2.3 toolchain ที่ขาดไม่ทำให้ worker ไม่เปิดและไม่ทำให้ Turn จบ
- [x] 2.4 test สร้าง toolchain layout ปลอมในโฟลเดอร์ชั่วคราวและพิสูจน์ผ่าน policy โดยไม่ผูกกับ Python ของเครื่อง
- [x] 2.5 test เดิมของ sandbox (อ่าน home, โฟลเดอร์ Runtime, โฟลเดอร์ Agent อื่น, symlink ออกนอก) ยังเขียวบน macOS

## 3. Task log เขียนได้เฉพาะ supervisor (#36)

- [x] 3.1 supervisor เป็นผู้เดียวที่เขียน Task log ส่วน worker ส่ง event ผ่าน stdio และ protocol มี event ที่จำเป็นครบ
- [x] 3.2 คำสั่งใน sandbox เขียนหรือลบ log ไม่ได้และได้ error ที่เห็นได้
- [x] 3.3 tool ทุกตัวที่เขียนไฟล์ของ Agent เขียน log ไม่ได้ด้วยกฎเดียวกัน ไม่ใช่เพราะตรวจที่ตัว tool
- [x] 3.4 Agent ยังอ่านประวัติ Task ของตัวเองได้ และ Task ยังขึ้นใน Controller
- [x] 3.5 event ที่เกิดก่อน worker ตายยังอยู่ใน log หลังเปิด worker ใหม่
- [x] 3.6 Agent ที่มี log อยู่ก่อนอัปเดตยังเห็นประวัติเดิมโดย Owner ไม่ต้องทำอะไร
- [x] 3.7 test ครอบทั้งคำสั่งและ tool และรันบน macOS กับ Linux

## 4. mach-lookup เป็นรายชื่อ (#37)

- [x] 4.1 profile ไม่มี `(allow mach-lookup)` แบบเปิดทั้งหมด และมีรายชื่อ service ที่ระบุเป็นตัว ๆ พร้อมเหตุผลว่ามาจาก worker, toolchain หรือ OS
- [x] 4.2 worker ยังขึ้น ready และรันหนึ่ง Turn ที่ใช้ `git` กับ `bun` ได้ใต้รายชื่อใหม่
- [x] 4.3 คำขอไป service ที่ไม่อยู่ในรายชื่อถูกปฏิเสธและเห็นได้ใน Runtime log
- [x] 4.4 test ตรวจพฤติกรรม ไม่ตรวจข้อความของ profile และผ่านบน macOS ใน CI
- [x] 4.5 ระบุชัดว่า mach-lookup ของ Chromium ยังไม่อยู่ในชิ้นนี้

## 5. ปิด change

- [x] 5.1 merge spec delta เข้า `openspec/specs/runtime-sandbox/` และ `openspec/specs/task-log/`
- [x] 5.2 รัน `bun run check`, `bun run test` และ `cargo test` ที่เกี่ยวข้อง แล้วรายงานผลจริง
- [x] 5.3 archive change นี้แล้วปิด issue #33 พร้อมอ้างถึง ticket #34–#37

## 6. หลักฐานการตรวจ (บน macOS 27.0.1, 13 พ.ย. 2026)

- `cargo check --workspace` → ผ่าน
- `cargo test --workspace -- --test-threads=1` → ผ่านทุก binary (`test result: ok` ทุกบรรทัด, exit 0) รวม `sandbox` 9 ตัว, `workers` 10 ตัว, `toolchain` 5 ตัว, `denials` 1 ตัว และ test ของ `runtime-core` / `runtime-worker`
- test ที่รันใต้ `sandbox-exec` จริงยืนยัน: อ่าน home ของเจ้าของไม่ได้, อ่านโฟลเดอร์ Runtime และ Agent อื่นไม่ได้, symlink ออกนอกอ่านไม่ได้, เขียน/ลบ/hard link `task-logs/<id>/tasks.db` ไม่ได้, service ที่ไม่อยู่ในรายชื่อถูกปฏิเสธ, worker รัน Turn ที่ใช้ `git` และ `bun` ได้
- ยังไม่ได้รันบน Linux ในเครื่องนี้: test ที่มี `cfg(linux)` และ job `Runtime and Protocol (Rust)` บน CI เป็นผู้ยืนยัน ส่วน `runtime-macos` จะรัน test ของ sandbox, workers และ denials ทุก pull request
