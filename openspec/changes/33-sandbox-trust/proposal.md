## Why

spec `runtime-sandbox` บอกว่า worker ทั้งตัวรันใน sandbox แล้ว แต่ยังมีสี่จุดที่ Owner ไว้ใจ sandbox นี้ไม่ได้ และจุดที่ทีมจะไม่รู้ตัวถ้ามันพัง (issue #33 ต่อจาก change `32-sandbox-whole-worker`)

- toolchain ที่ติดตั้งแบบ framework เช่น Python จากตัวติดตั้ง python.org ถูก OS ปฏิเสธ เพราะ allow-list เขียนด้วยมือ และไม่มีใครรู้ตอนมันขาด
- Task log (`tasks.db`) อยู่ในโฟลเดอร์ที่ sandbox ให้เขียนได้ คำสั่งที่โดน prompt injection จึงแก้หรือลบประวัติ Task ได้
- profile ของ macOS ยัง `(allow mach-lookup)` ทั้งหมด ซึ่งเป็นทางออกนอกกรอบไฟล์ผ่าน service ของระบบ
- test ที่รันใต้ `sandbox-exec` จริงไม่เคยรันบน macOS ใน CI เลย ทั้งที่ macOS คือระบบที่ profile เปราะที่สุด

## What Changes

- allow-list ของ macOS ครอบ framework-style toolchain (`/Library/Frameworks`, `/Library/Python`) และ supervisor ตรวจ toolchain หลัก (`git`, `python3`, `node`, `bun`) ใต้ sandbox เดียวกับ worker ตอนเปิด worker แล้วบันทึกผลเป็น log ระดับ Runtime — ขาดตัวไหนก็ไม่หยุด worker
- supervisor เป็นผู้เดียวที่เขียน Task log ส่วน worker ส่ง event ผ่าน stdio ที่มีอยู่ และเพิ่ม event ที่ยังขาดใน protocol ระหว่าง supervisor กับ worker คำสั่งและ tool ทุกตัวของ Agent เปิด log เพื่อเขียนไม่ได้ แต่ยังอ่านประวัติของตัวเองได้
- `mach-lookup` เปลี่ยนจากเปิดทั้งหมดเป็นรายชื่อ service ขั้นต่ำที่ worker และ toolchain ต้องใช้ พร้อมเหตุผลกำกับทีละตัว
- CI มี job `runtime-macos` ที่รัน test ใต้ `sandbox-exec` จริงทุก pull request ที่แตะ Runtime โดยไม่พึ่ง Docker, Postgres หรือเครือข่าย

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `runtime-sandbox`: toolchain ที่ติดตั้งแบบ framework อยู่ใน allow-list, Runtime รายงาน toolchain ที่ใช้ไม่ได้ตอนเปิด worker, Task log เขียนได้เฉพาะ supervisor, `mach-lookup` เป็นรายชื่อ service
- `task-log`: เจ้าของผู้เขียน log คือ supervisor ไม่ใช่ worker

## Impact

- `runtime-core`: allow-list ของ macOS, protocol ระหว่าง supervisor กับ worker (`ToWorker` / `FromWorker`) สำหรับ event ที่ supervisor ต้องเขียนเอง
- `runtime-supervisor`: self-check ของ toolchain, การเขียน Task log, การย้าย log ของ Agent เดิม, profile ของ mach-lookup
- `runtime-worker`: การส่ง event แทนการเขียน log เอง และการอ่านประวัติที่ยังทำได้
- CI: job `runtime-macos`
- ผู้ใช้: ประวัติ Task ใช้ตรวจสอบย้อนหลังได้จริง และ toolchain ที่ใช้ไม่ได้ถูกบอกตอนเปิด worker ก่อน Agent ไปเจอเอง
