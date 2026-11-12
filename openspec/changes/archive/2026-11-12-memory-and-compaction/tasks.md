## 1. Memory

- [x] 1.1 เพิ่ม `runtime-core/src/memory.rs`: อ่าน `MEMORY.md`, ตัด 4,000 chars, ต่อท้ายข้อความให้ย่อ, test
- [x] 1.2 เพิ่ม `AgentCore::with_workdir` และใส่ Memory ใน system prompt ตอนเริ่ม Turn
- [x] 1.3 ให้ worker ส่ง `config.dir/workdir` ให้ core
- [x] 1.4 เพิ่มคำสั่งอ่าน Memory `veeloe memory <agent>` ใน `runtime-supervisor/src/memory.rs`: แสดง Agent, ที่อยู่ไฟล์, จำนวนตัวอักษร และเนื้อหาที่ Turn ถัดไปเห็น; รับ id หรือชื่อ, ชื่อซ้ำให้ใช้ id, อ่าน Agent ในถังขยะได้, ไม่สร้าง Workdir; ต่อเข้า `main.rs` กับ `help.rs` พร้อม test

## 2. Compaction

- [x] 2.5 อ่าน context window จาก Provider model list และแสดงใน model picker; ไม่มีใช้ 128K fallback
- [x] 2.1 นับ token ของ conversation และย่อเมื่อถึง 70% ของ context
- [x] 2.2 เรียก LLM สรุปทั้งก้อนพร้อม prompt ที่บอกเป้าหมาย/ไฟล์ที่แก้/งานค้าง
- [x] 2.3 เก็บ summary เป็น event ใหม่และใช้กับ request ถัดไป
- [x] 2.4 test กับ mock LLM; Provider จริงยังไม่ทดสอบ
- [x] 2.6 แสดงการ์ด `context.compacted` ในหน้า Task พร้อมกดดู/ซ่อน summary
- [x] 2.7 Runtime เขียน `context.usage`; Controller แสดงวงแหวนข้างปุ่มส่งและกดดู used/window/threshold

## 3. ตรวจ

- [x] 3.1 `cargo test -p veeloe-runtime-core --lib memory`
- [x] 3.2 `cargo test -p veeloe-runtime-worker --no-run`
- [x] 3.3 QA: สร้าง `MEMORY.md`, เปิด Task ใหม่ แล้วตรวจว่า prompt มี Memory (ทำบน emulator กับ mock Provider: request ที่ออกไปมี `MEMORY.md` พร้อม sentinel อยู่ใน system prompt)
- [x] 3.4 ตรวจ `veeloe memory` กับ VEELOE_HOME ชั่วคราว: มีไฟล์แสดงเนื้อหากับจำนวนตัวอักษร, ไม่มีไฟล์บอกว่า prompt ไม่มี Memory และไม่สร้าง Workdir, Agent ที่ไม่รู้จักออกด้วย exit code 2
