## 1. Protocol

- [x] 1.1 เพิ่ม `agent.create`, `agent.list` และ `agent.listed` พร้อม vector ตรวจด้วย test เรื่องรูปร่างผิดและ field ที่ไม่รู้จัก
- [x] 1.2 เพิ่ม `task.message`, `task.event`, `task.sync`, `task.events` และ `ref` ใน `error` พร้อม vector ตรวจด้วย test ว่า header `task` ต้องตรงกับสำเนาที่เซ็น

## 2. supervisor

- [x] 2.1 ย้าย `trust.json` กับ `seen.json` ไป `runtime/` พร้อม rename ไฟล์เก่า ย้าย pairing เข้า slice ของตัวเอง และเพิ่มกฎ dependency-cruiser ว่า slice ไม่ import กัน ตรวจด้วย test ของ pairing เดิม และ import ข้าม slice ที่ใส่ทดลองทำให้ `check` ล้ม
- [x] 2.2 เพิ่ม `veeloe provider add`, `list` และ `remove` ตรวจด้วย test ที่ใช้ Provider ปลอมเรื่อง key ผิด, URL ติดต่อไม่ได้, ชื่อซ้ำ, หัว `x-api-key` กับ `Bearer`, สิทธิ์ 0600 และ `list` ไม่มี key
- [x] 2.3 เพิ่ม proxy ของ LLM ตรวจด้วย test เรื่องไม่มีรหัสหรือรหัสผิด, path ที่ไม่อนุญาต, model ถูกเขียนทับ, SSE ผ่านตามที่ได้ และ Provider ล่ม
- [x] 2.4 เพิ่มรายชื่อ Agent, Workdir และการเปิด worker ทาง IPC พร้อมเปิดใหม่เมื่อพัง ตรวจด้วย test ว่า worker ตัวหนึ่งพังแล้วตัวอื่นยังตอบ และเริ่ม supervisor ใหม่แล้ว worker ทุกตัวกลับมา
- [x] 2.5 เพิ่ม slice `agents` (`agent.create`, `agent.list`) และ slice `task-message` กับ `task-sync` ที่ส่งต่อให้ worker และส่ง event กลับถึงคนเริ่ม Task ตรวจด้วย test เรื่องลายเซ็นผิด, กุญแจไม่อยู่ใน trust, `member` ในหัวซองไม่ตรง, Agent ไม่มี, Provider ไม่มี และ Task ของคนอื่น
- [x] 2.6 เพิ่ม Provider สำเร็จรูป (`anthropic`, `opencode-go`, `openrouter`) ที่ใช้วิธีส่ง key ตามตาราง และ header `user-agent` กับ `x-opencode-session` ที่เป็นรหัส Task ซึ่ง worker ส่งมาทาง IPC ตรวจด้วย test ที่ส่งผ่าน proxy จริงไป Provider ปลอมว่าได้ header ครบและไม่มี `x-veeloe-*` และ OpenRouter ได้ `Bearer` แม้รายชื่อ model เปิดให้ทุกคน
- [x] 2.7 เพิ่ม `provider add` แบบถามทีละขั้นกับ `--preset` และ `provider remove` แบบเลือก ที่บอก Agent ที่ใช้อยู่และถามยืนยันโดยค่าเริ่มต้นคือไม่ลบ พร้อม `--yes` ตรวจด้วย test ว่าไม่มี terminal แล้วไม่ถามและบอก flag ที่ขาด, ตอบผิดแล้วถามซ้ำ, ตอบไม่ลบแล้ว Provider ยังอยู่ และ key ที่เป็น argument ถูกปฏิเสธโดยไม่พิมพ์ออกมา
- [x] 2.8 เพิ่ม `veeloe` ครั้งแรกที่พา Pairing กับเพิ่ม Provider, `veeloe status` กับไฟล์ pid และ help ของทุกคำสั่ง ตรวจด้วย test ว่า status ไม่มี key, ไฟล์ pid ค้างถือว่าไม่ทำงาน, ไม่มี terminal แล้วบอกขั้นตอนแทนการรอ และคำสั่งที่ไม่รู้จักชี้ไป `--help`

## 3. worker

- [x] 3.1 เพิ่มแกนของ worker (`runTurn`, การรับข้อความ, `agent.busy`, รหัสข้อความซ้ำ, tool round, tool ที่ไม่มี, เพดานรอบ, Provider ล้มเหลว, ข้าม Turn ที่ไม่จบ) ตรวจด้วย test ที่ใช้ port ปลอมทั้งหมด
- [x] 3.2 เพิ่ม adapter `bun:sqlite` ของ `tasks.db` และ adapter ของ `@anthropic-ai/sdk` ที่ชี้ไป proxy ตรวจด้วย test บน `bun:sqlite` เรื่องเลขต่อกัน, ข้อความซ้ำ, event หลังเลข N และอยู่รอดหลังเปิดใหม่ และ test ที่ใช้ Provider ปลอมผ่าน proxy จริงว่า thinking block กลับไปในคำขอถัดไปทุกตัวอักษร

## 4. Controller

- [x] 4.1 เพิ่ม migration และ `entities/agent` กับ `entities/task` พร้อม `pending_message` ตรวจด้วย test บน `bun:sqlite` เรื่องรวม event ซ้ำ, ลำดับ, pending ที่ถูกลบเมื่อข้อความกลับมา และล้มเหลวเมื่อได้ error ที่ `ref` ตรงกัน
- [x] 4.2 เพิ่ม `features/machine-link` ที่ต่อ Hub ระหว่างปลดล็อก ขอรายชื่อกับ sync เมื่อต่อได้ และเขียนลงฐานข้อมูล ตรวจด้วย test ที่ใช้ Hub ปลอมเรื่องซองจากกุญแจอื่น, ต่อใหม่แล้วขอหลังเลขล่าสุด และหยุดเมื่อล็อก
- [x] 4.3 เพิ่มหน้าแรกที่มี Agent ใต้ Machine และหน้าสร้าง Agent ทั้งสองภาษาและ error code ใหม่ใน `errors` ตรวจบน iOS Simulator และเว็บ ทั้งสว่างและมืด รวมกรณีไม่มี Provider และ Machine ออฟไลน์
- [x] 4.4 เพิ่มหน้า Task และหน้า Agent ตรวจบน iOS Simulator และเว็บกับ Runtime จริงและ Provider ปลอม เรื่องส่งข้อความ, `agent.busy`, Turn ที่จบด้วย error, Task ใหม่ และปิดแอประหว่าง Turn แล้วเปิดใหม่

## 5. ปิดงาน

- [x] 5.1 เพิ่ม e2e ที่รัน Hub, `veeloe` ตัวจริงกับ Provider ปลอม และ client ของ Controller ตรวจว่าสร้าง Agent, คุยสองข้อความใน Task เดียว และ sync หลังหลุดได้
- [x] 5.2 เขียน `manual-checks.md` ให้เจ้าของลองกับ Provider จริงบน iPhone และเว็บ และแก้ `AGENTS.md`
