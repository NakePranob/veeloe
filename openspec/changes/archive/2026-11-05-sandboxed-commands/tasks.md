## 1. sandbox-runtime

- [x] 1.1 pin `@anthropic-ai/sandbox-runtime` ตรงตัว แล้วลองกับ binary ที่ `bun build --compile` บน macOS และ Linux นอก container ว่า (ก) กฎต่อ worker ตอน `wrapWithSandbox` ได้ (ข) ห้ามอ่าน `<VEELOE_HOME>` ยกเว้น `agents/<id>/` กับ `bin/` ได้หรือต้องใช้ทางสำรองใน design (ค) ช่อง `ipc` ของ `Bun.spawn` ผ่าน sandbox (ง) แก้ `allowedDomains` ขณะรันได้ (จ) `kill` supervisor ไม่ได้ (ฉ) ไฟล์ประกอบของ sandbox-runtime อยู่ใน binary ตรวจด้วย script ชั่วคราวและจดผลกับทางที่เลือกลง `design.md` ก่อนทำข้อต่อไป

## 2. Protocol

- [x] 2.1 เพิ่ม `EgressDomainSchema`, `egress.set` และ field `egress` ใน `agent.listed` พร้อม vector ตรวจด้วย test ว่ารับ `github.com` กับ `*.npmjs.org` และปฏิเสธ IP, `localhost`, scheme, path, `*.*` และรายชื่อเกิน 100

## 3. supervisor

- [x] 3.1 ย้ายคำขอ LLM จาก `Bun.serve` มาเป็น `llm.request` กับ `llm.response` ทาง IPC และลบรหัสของ worker ตรวจด้วย test ของ proxy เดิมที่ปรับมาใช้ IPC (path ที่ไม่อนุญาต, model ถูกเขียนทับ, SSE ครบ, Provider ล่ม, Provider ถูกลบ) และ worker env ไม่มี `VEELOE_PROXY_*`
- [x] 3.2 เพิ่ม `supervisor/sandbox/` (`check`, `policyFor`, `wrap`) และให้ `createWorkers` เปิด worker ผ่าน `wrap` ตรวจด้วย test ของ `policyFor` ว่าเขียนได้แค่โฟลเดอร์ตัวเอง ห้ามอ่าน `runtime/`, กุญแจของ Machine, Agent อื่นและไฟล์ลับทุกรายการ และ test ของ `check` ว่า OS อื่นหรือขาด bubblewrap ได้ข้อความกับ exit code 1 โดยไม่เปิด worker
- [x] 3.3 เพิ่ม slice `egress` ที่เก็บ `runtime/egress.json`, รับ `egress.set`, อัปเดต sandbox ทันที และตอบ `agent.listed` ที่มี `egress` และให้ `unpair` ลบไฟล์ เพิ่ม slice ในกฎ dependency-cruiser ตรวจด้วย test เรื่องลายเซ็นผิด, กุญแจไม่อยู่ใน trust, รายการผิดรูปแบบแล้วไม่บันทึกอะไร, ส่งซ้ำได้ผลเดิม และ Pairing ใหม่หลัง unpair เห็นรายชื่อว่าง

## 4. worker

- [x] 4.1 เปลี่ยน `anthropic-llm.ts` ให้ส่ง `fetch` ที่วิ่งทาง IPC ให้ SDK ตรวจด้วย test ที่ใช้ supervisor link ปลอมว่า thinking block กลับไปในคำขอถัดไปทุกตัวอักษร และ error จาก `x-veeloe-error` ยังเป็น code เดิม
- [x] 4.2 เพิ่ม `worker/adapters/bash.ts` แทน `no-tools` ตรวจด้วย test ที่รันนอก sandbox เรื่อง cwd เป็น Workdir, `cd` ไม่ติดข้ามคำสั่ง, stdin ปิด, stdout กับ stderr รวมตามลำดับ, exit code ไม่ใช่ 0 เป็น error, ตัดผลเกิน 30,000 ตัวอักษร, หมดเวลาแล้วไม่เหลือโปรเซสลูก, เพดาน 600 วินาที และ env ไม่มีตัวแปร IPC

## 5. Controller

- [x] 5.1 เพิ่ม item ชนิด `tools` ใน `pages/task/model/items.ts` และ `ToolCalls` ตาม `controller-prototype/src/pages/task/ui/ToolCalls.tsx` ทั้งสองภาษา ตรวจด้วย test ของ `items()` เรื่องรวมคำสั่งติดกัน, จับคู่ผลด้วย `tool_use_id`, ล้มเหลว และไม่เสร็จเมื่อ Turn จบก่อน แล้วดูบน iOS Simulator และเว็บ สว่างและมืด กับ Runtime จริง
- [x] 5.2 เพิ่ม migration คอลัมน์ `egress` ของ `machine`, การเขียนจาก `agent.listed` ใน `machine-link` และส่วน Egress ในหน้า Machine ตาม `controller-prototype/src/pages/machines/ui/EgressSection.tsx` ที่ยืนยันตัวใหม่ก่อนส่ง `egress.set` ตรวจด้วย test บน `bun:sqlite` ว่า `egress` ถูกเขียน แล้วดูบน iOS Simulator และเว็บเรื่องเพิ่ม, ลบ, โดเมนผิดรูปแบบ, Egress ว่าง และ Machine ออฟไลน์

## 6. ปิดงาน

- [x] 6.1 เพิ่ม e2e ที่รัน `veeloe` ตัวจริงใน sandbox กับ Provider ปลอมที่ขอ `bash` ตามลำดับ แล้วตรวจว่า `pwd` ได้ Workdir, อ่าน `~/.ssh` (HOME ปลอม), `runtime/providers.json` และ Workdir ของ Agent อื่นไม่ได้, เขียนนอกโฟลเดอร์และผ่าน symlink ไม่ได้, `curl` โดเมนนอก Egress กับ `127.0.0.1` ไม่ได้ และหลัง `egress.set` ต่อ Provider ปลอมด้วยชื่อโดเมนได้ ให้ CI บน Linux ติดตั้ง bubblewrap กับ socat และเปิด user namespace
- [x] 6.2 เขียน `manual-checks.md` ให้เจ้าของลองบน macOS และ Linux จริงกับ Provider จริง แก้ `AGENTS.md` เรื่อง bubblewrap ที่ e2e ต้องใช้ และแก้ `docs/roadmap.md` เมื่อ archive
