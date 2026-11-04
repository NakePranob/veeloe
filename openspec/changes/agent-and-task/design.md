## Context

- `packages/runtime` มี supervisor ที่ต่อ Hub, ตรวจซองกับ `trust.json` และ `seen.json` แล้ว log ไว้เฉยๆ worker เป็นแค่ stub ที่พิมพ์บรรทัดเดียว
- `machine-pairing` วาง `trust.json` กับ `seen.json` ไว้ที่ root ของ `VEELOE_HOME` แต่ ADR 0032 ให้ state ของ supervisor อยู่ใน `runtime/`
- Hub ส่งต่อซองจาก Controller ถึง Machine ด้วย `to` และจาก Machine ถึง Member ด้วย `recipients` อยู่แล้ว change นี้จึงไม่แตะ Hub
- Controller มี `shared/hub-client` ที่ใช้เฉพาะตอน Pairing, ตาราง `machine` และ `useLiveQuery`
- v0.1 มี Member คนเดียวคือ Owner ซึ่งมี Manage ทุก Agent (ADR 0031) การตรวจสิทธิ์จึงเท่ากับการตรวจว่ากุญแจอยู่ใน trust แต่ทุกข้อความยังพก Member ตาม ADR 0010

## Goals / Non-Goals

**Goals:**
- Owner รัน `veeloe provider add` กับ `veeloe` แล้วสร้าง Agent และคุยใน Task จากมือถือได้จริงกับ Provider จริง
- แกนของ worker ทดสอบได้ด้วย port ปลอมทั้งหมด และ tool round ใช้ได้แล้วตั้งแต่ change นี้ แม้ยังไม่มี tool จริง

**Non-Goals:**
- tool จริง, sandbox, Approval และ Egress
- คิวงาน การปิด Turn ที่ค้าง Stop และ Budget ซึ่งมี change ของตัวเองใน roadmap
- ข้อความที่ LLM กำลังพิมพ์ทีละส่วน, Effort, การเปลี่ยน model ของ Agent และการลบหรือเปลี่ยนชื่อ Agent
- Inbox, Character และ Mood

## Decisions

### ไฟล์ของ supervisor ย้ายไป `runtime/`

`trust.json` กับ `seen.json` ย้ายไป `<VEELOE_HOME>/runtime/` ตาม ADR 0032 พร้อมไฟล์ใหม่ `providers.json` และ `agents.json` ทุกไฟล์ใช้ `writeJsonFile` เดิมซึ่งเขียนแล้ว rename และสิทธิ์ 0600 ตอนเริ่ม ถ้าเจอสองไฟล์เก่าที่ root ให้ rename เข้ามา `machine.key` กับ `config.json` อยู่ที่เดิมตามแผนผังของ ADR

ADR 0014 ให้ supervisor เก็บ state ใน bun:sqlite แต่รายชื่อสั้นๆ ไม่กี่รายการยังไม่คุ้ม จะย้ายเมื่อมีข้อมูลที่ต้อง query เช่น Grant หรือ Budget ต่อวัน

### Provider ตั้งด้วย CLI และ key ไม่ออกจากเครื่อง

`veeloe provider add --name <n> --url <base>` อ่าน key จาก terminal แบบปิดการแสดงผล หรือจาก stdin เมื่อไม่ใช่ terminal (ใช้ใน test และ e2e) key ไม่รับเป็น argument เพราะจะไปค้างใน shell history และ `ps` แล้วถาม `GET <base>/v1/models` เพื่อยืนยัน ลองส่ง key เป็น `x-api-key` ก่อน ถ้าไม่ผ่านจึงลอง `Authorization: Bearer` แล้วบันทึกวิธีที่ใช้ได้ เพราะ Anthropic กับ gateway อย่าง OpenRouter รับ key ต่างหัวกัน การใส่ key ในแอปแบบ sealed box เป็น change แยก (`provider-keys-in-app`) ซึ่งเพิ่มใน roadmap พร้อม change นี้

### proxy ของ LLM ใน supervisor

supervisor เปิด `Bun.serve` ที่ `127.0.0.1` port สุ่ม และออกรหัสสุ่ม 256 bit ให้ worker แต่ละตัวตอนเปิด worker ได้ URL ของ proxy กับรหัสทางตัวแปร environment แล้วตั้งเป็น `baseURL` กับ `apiKey` ของ `@anthropic-ai/sdk` proxy หาว่ารหัสเป็นของ Agent ไหน ตัดหัวที่เกี่ยวกับ key ทิ้ง ใส่ key ของ Provider ตามวิธีที่บันทึกไว้ เขียน `model` ใน body ของ `POST /v1/messages` เป็นของ Agent แล้วส่งต่อและส่ง body ของคำตอบกลับตามที่ได้ (รวม SSE) ผ่านไปเฉพาะ `/v1/messages` กับ `/v1/messages/count_tokens` เพื่อไม่ให้ worker ใช้ key ทำอย่างอื่น ตรงนี้คือที่ที่ `daily-budget` จะนับ token ต่อไป (ADR 0043)

ทางเลือกที่ตัดออก: ส่งคำขอ LLM ผ่าน IPC ไม่ต้องเปิด port แต่ต้องเขียน transport ให้ SDK เอง และใช้กับ streaming ได้ยาก

### worker หนึ่งโปรเซสต่อ Agent คุยกับ supervisor ทาง IPC

supervisor เปิด worker ด้วย `Bun.spawn([process.execPath, ...], { ipc })` ในโหมด binary และด้วย `bun src/main.ts` ตอนพัฒนา cwd คือ Workdir และ `TMPDIR` คือ `agents/<id>/tmp` ข้อความ IPC เป็น JSON:

- supervisor → worker: `message` (task, id, member, text), `sync` (request, task, after)
- worker → supervisor: `event` (task, starter, event), `error` (ref, code), `events` (request, task, events), `ready`

worker ที่จบเองถูกเปิดใหม่ด้วย `createBackoff` เดิม ซึ่งเริ่มนับใหม่เมื่อ worker อยู่ได้เกิน 60 วินาที ถ้า worker ล่มระหว่างที่ supervisor ส่งข้อความหา supervisor ตอบ `agent.unavailable` แทนการเก็บไว้ เพราะคิวงานยังไม่มี

### แกนของ worker เป็นโค้ดล้วน

`worker/core/` มี `runTurn` และกฎการรับข้อความ คุยกับข้างนอกผ่าน port ตาม ADR 0022 คือ `Clock`, `EventStore`, `Llm`, `ToolRunner` และ `SupervisorLink` adapter อยู่ใน `worker/adapters/` ได้แก่ `bun:sqlite`, `@anthropic-ai/sdk`, `no-tools` และ ipc dependency-cruiser มีกฎนี้อยู่แล้ว change นี้เพิ่มกฎว่า slice ของ supervisor (`pairing`, `agents`, `task-message`, `task-sync`) ไม่ import กัน และย้าย `pair.ts` กับ `unpair.ts` เข้า `supervisor/pairing/`

Turn หนึ่งคือ: บันทึกข้อความของ Member → บันทึก `turn.started` → สร้างบทสนทนาจาก log → เรียก LLM → บันทึกผลตามที่ได้ → ถ้ามี `tool_use` เรียก `ToolRunner` บันทึกผลแล้ววนต่อ → บันทึก `turn.ended` พร้อม `reason` (`done` หรือ `error` กับ code) ทุกรอบกันวนไม่จบด้วยเพดาน 50 รอบต่อ Turn LLM ใช้ `messages.stream().finalMessage()` เพราะ SDK ไม่ยอมให้คำขอที่ไม่ stream ใช้ `max_tokens` สูง และเพดาน `max_tokens` ตั้งไว้ 8192

### event ใน `tasks.db`

`tasks.db` อยู่ที่ `agents/<id>/tasks.db` ข้าง Workdir มีสองตาราง `task(id, starter, created_at)` และ `event(task_id, seq, kind, body, at)` ที่มี primary key `(task_id, seq)` และ unique index ของรหัสข้อความ ซึ่งทำให้ข้อความซ้ำไม่ถูกเพิ่ม `body` เก็บ JSON ตามที่ได้ เช่น `content` ของ LLM ทุก block รวม thinking เพื่อให้สร้างคำขอถัดไปได้ตรงทุกตัวอักษร (ADR 0018) ชนิดของ event คือ `member.message`, `turn.started`, `llm.message`, `tool.result` และ `turn.ended` ชนิดใหม่ในอนาคตเพิ่มได้ตาม ADR 0023 และ Controller ข้ามชนิดที่ไม่รู้จัก

### ข้อความใน Protocol

ทุกข้อความจาก Controller ใช้ `to: <machine id>` และ `member` ในหัวซอง ทุกข้อความจาก Machine ใช้ `recipients` เป็น Member ที่เกี่ยว

- `agent.create` body `{ id, name, provider, model }` และ `agent.list` body `{}` ทั้งคู่ได้ `agent.listed` body `{ agents: [{ id, name, provider, model }], providers: [{ name, models: [{ id, name }] } | { name, error }] }`
- `task.message` หัวซองมี `task` body `{ agent, id, text }`
- `task.event` หัวซองมี `task` body `{ agent, seq, kind, at, body }` ซึ่ง `body` ของ `member.message` มี `member` กับ `id`
- `task.sync` หัวซองมี `task` body `{ agent, after }` ได้ `task.events` body `{ agent, events: [...] }` ทีละไม่เกิน 100 event
- error จาก Machine ใช้ข้อความ `error` เดิม และเพิ่ม `ref` เป็นลายเซ็นของซองที่เป็นต้นเหตุ ซึ่ง schema แบบ loose รับอยู่แล้ว

supervisor ตรวจว่า `member` ในหัวซองตรงกับ Member ของกุญแจใน trust ถ้าไม่ตรงให้ทิ้ง เพราะ Member มาจาก trust ไม่ได้มาจากหัวซอง รายชื่อ Provider ถามจาก Provider ใหม่ทุกครั้งที่มี `agent.list` โดยจำกัดเวลา 10 วินาที

### Controller: การเชื่อมต่อเดียวต่อ Hub

slice `features/machine-link` เปิด `startHubClient` หนึ่งตัวต่อ Hub URL ที่ Machine ใช้ trusted keys คือกุญแจของ Machine บน Hub นั้น ทำงานเมื่อกุญแจปลดล็อก และหยุดเมื่อล็อก เพราะเซ็นไม่ได้ เมื่อ `onReady` ส่ง `agent.list` ถึงทุก Machine และ `task.sync` ของทุก Task ด้วยเลขล่าสุดที่เก็บ ซองที่เข้ามาแยก Machine ตามกุญแจที่เซ็น แล้วเขียนลง SQLite ก่อนเสมอ (ADR 0021) slice นี้ export `send` ให้หน้าใช้ และ `app/` เป็นคนเปิด

Machine นับว่าออนไลน์เมื่อได้ `agent.listed` ในการเชื่อมต่อครั้งนี้ และออฟไลน์เมื่อ Hub ตอบ `hub.machine_offline` สถานะที่ละเอียดกว่านี้อยู่ใน `logs-and-machine-status`

migration ใหม่เพิ่มตาราง `agent`, `task`, `task_event` และ `pending_message` ข้อความที่ Owner ส่งลง `pending_message` ก่อน แล้วถูกลบเมื่อ `member.message` ที่มีรหัสเดียวกันกลับมา หรือถูกตั้งเป็นล้มเหลวพร้อม code เมื่อได้ `error` ที่ `ref` ตรงกัน

### หน้าจอของ Controller

ใช้โครงของหน้า Task ใน `controller-prototype/src/pages/task/` แค่ส่วนที่ต้องใช้ คือ bubble ของข้อความ, ตัวแสดงว่ากำลังทำงาน และช่องพิมพ์ ไม่มี Character, Effort, Approval หรือ tool call ที่พับไว้

- หน้าแรก: การ์ดของ Machine มีรายชื่อ Agent ข้างใน และปุ่มสร้าง Agent แตะ Agent แล้วเปิด Task ล่าสุด หรือ Task ใหม่ถ้ายังไม่มี โดยไม่มีหน้าเลือกคั่น
- หน้าสร้าง Agent: ชื่อ, Provider และ model จาก `agent.listed` ถ้าไม่มี Provider ให้แสดงคำสั่ง `veeloe provider add`
- หน้า Task: ปุ่มที่หัวหน้าเปิดหน้า Agent
- หน้า Agent: รายชื่อ Task และปุ่ม Task ใหม่ รหัส Task สร้างที่ Controller

## Risks / Trade-offs

- [ข้อความที่มาระหว่าง Turn ถูกปฏิเสธด้วย `agent.busy`] → Controller บอกว่า Agent ยังทำงานอยู่ และคิวมาใน `one-writer-queue`
- [worker พังกลาง Turn แล้ว log มี `turn.started` ที่ไม่มี `turn.ended`] → harness ข้าม Turn ที่ไม่จบตอนสร้างบทสนทนา โดยไม่ส่ง `tool_use` ที่ไม่มีผลให้ LLM การปิด Turn ด้วย event ตาม ADR 0033 อยู่ใน `stop-and-restart`
- [รหัสของ worker อยู่ใน environment ของ worker] → Agent ยังไม่มี tool จึงอ่านไม่ได้ และรหัสใช้ได้แค่กับ proxy บนเครื่อง ส่วน key ของ Provider ไม่เคยถึง worker เมื่อมี bash, sandbox ต้องกันการอ่าน environment ของโปรเซสอื่น
- [ไม่มี delta ระหว่าง LLM พิมพ์ คำตอบยาวรอนาน] → แสดงว่ากำลังทำงาน และค่อยเพิ่ม delta ใน `controller-task-screens`
- [event ของ Task ไปถึงเฉพาะ Controller ที่ต่ออยู่ Hub ไม่เก็บ] → Controller ขอ `task.sync` ทุกครั้งที่ต่อได้
- [ถาม model จาก Provider ทุกครั้งที่เปิดแอป] → ช้าได้ถึง 10 วินาทีต่อ Provider ถ้าใช้จริงแล้วช้า ค่อย cache ไว้ใน supervisor
