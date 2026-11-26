## Context

- worker ไม่มี port ให้เรียก ส่ง `llm.request` ทาง IPC แทน (`sandboxed-commands`) `ipcFetch` ใน `worker/adapters/anthropic-llm.ts` เป็น `fetch` ของ SDK ที่ส่ง `llm.request` แล้วสร้าง `Response` จริงจาก `llm.response` ที่ได้ SDK จึงยังเห็นคำตอบของ supervisor เป็น HTTP ทั้ง status และหัว
- `createLlmHandler` ใน `supervisor/proxy/proxy.ts` เป็นที่เดียวที่คำขอออกไป Provider: หา Route ของ Task (ตรึงใน `task-routes.json` ตาม `agent-settings`), อ่านแล้วตัดหัว `x-veeloe-task`, ใส่ `upstreamHeaders` แล้ว `fetch` และอ่านคำตอบทั้งก้อนด้วย `upstream.text()` ก่อนตอบทาง IPC ครั้งเดียว stream ของ SSE จึงมาถึงเป็นข้อความเต็มแล้ว คำปฏิเสธของ supervisor เอง (`refuse`) พกหัว `x-veeloe-error` และมี comment ว่า `daily-budget` จะอ่าน `usage` ตรงนี้
- adapter แปลง `APIError` ที่มีหัว `x-veeloe-error` เป็น `LlmError(code)` และ `runTurn` จบ Turn ด้วย `turn.ended { reason: "error", code }` ทางนี้จึงพา code ใหม่ถึง Task ได้โดยไม่แก้ worker
- `@anthropic-ai/sdk` 1.4 ลองส่งซ้ำเมื่อได้ 408, 409, 429 หรือ 5xx (`maxRetries: 2`) เว้นแต่คำตอบมีหัว `x-should-retry: false`
- `agent.update` มีแล้ว (`agent-settings`) ใน slice `agents`: ตรวจทุก field ก่อนเขียน, `registry.replace` เขียนทั้งไฟล์ และส่ง `agent.listed` ถึงทุก Member ฝั่ง Controller `updateAgent` ของ `features/machine-link` จำ error ไว้ใน `updateError` ซึ่งหน้า Agent แสดงอยู่แล้ว
- `agent.listed` ส่ง `registry.all()` ตรงๆ ส่วน Controller เขียนตาราง `agent` ด้วย `INSERT OR REPLACE` และหน้า Task แสดง error ของ Turn ด้วย `Problem` ที่ใช้ `describeError`
- ADR 0043 ตัดสินไว้แล้วว่านับเป็น token ไม่นับเป็นเงิน, Budget ก้อนเดียวต่อ Agent, ค่าเริ่มต้น 10M, คนที่มี Manage ตั้ง, วันใหม่ 04:00 ตามเวลาของ Machine และเก็บยอดตามวันที่โดยไม่ตั้งนาฬิกา

## Goals / Non-Goals

**Goals:**
- Agent ที่ใช้ token ถึง Budget หยุดเองภายในคำขอเดียว และ Agent ตัวอื่นไม่สะดุด
- Owner เห็นยอดของวันนี้และตั้ง Budget จากมือถือได้ ตามหน้า Agent ของ prototype

**Non-Goals:**
- push ตอนใช้ถึง 80% และตอนหมด ซึ่งอยู่ใน `push-notifications` (ADR 0044)
- ราคาโดยประมาณเป็นเงิน, ยอดแยกตามที่มา, ยอดต่อ Member ต่อเดือน และหน้ารวมการใช้ token
- เพดานของ Idle Work กับ Watch (ADR 0056) ซึ่งมาพร้อมสองอย่างนั้นใน v0.2
- การ์ด Budget บนหน้า Machine ซึ่งเป็นส่วนของสถานะ Machine ใน `logs-and-machine-status` (ADR 0052)
- การตั้ง Budget จาก CLI

## Decisions

### หน่วยและขอบเขตตาม ADR 0043

นับเป็น token ต่อ Agent ต่อวัน รวมสี่ field ของ `usage` คือ `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` และ `output_tokens` ไม่ถ่วงน้ำหนัก cache เพราะ ADR ตัดทางนั้นไว้แล้ว

ทางเลือกที่ ADR ตัดไว้: นับเป็นเงินซึ่งต้องดูแลตารางราคาเอง, ถ่วงน้ำหนัก cache และ Budget ต่อ Machine แทนต่อ Agent ราคาโดยประมาณยังไม่ทำ เพราะต้องมีตารางราคาซึ่งไม่มีที่มาที่เชื่อได้สำหรับทุก gateway เมื่อทำ ให้เป็นแค่ตัวเลขที่ Controller คำนวณเองและไม่เกี่ยวกับการบังคับ

### Budget เป็นของ Agent ไม่ว่า Task ตรึง model ไหน

Route ของแต่ละ Task ตรึง Provider กับ model ไว้ (`agent-settings`) แต่ Budget กับยอดผูกกับ Agent ที่ช่อง IPC เป็นของมัน ไม่ใช่กับ Route token ของทุก Task บวกเข้ายอดเดียว ไม่ว่าจะไป model ไหน และการเปลี่ยน Provider หรือ model ไม่ล้างยอด ต่างจาก Provider กับ model ที่มีผลตั้งแต่ Task ถัดไป Budget ใหม่มีผลกับคำขอถัดไปของทุก Task ทันที เพราะ handler อ่าน Budget ตอนรับคำขอแต่ละครั้ง ไม่ได้ตรึงไว้กับ Task

### module ร่วม `supervisor/budget/`

ADR 0022 ให้ proxy ที่นับ Budget เป็น module ร่วม ไม่ใช่ slice จึงวาง `supervisor/budget/budget.ts` ไม่ต้องแก้กฎ `supervisor-slices-apart` เพราะไม่ใช่ slice มี

- `budgetDay(now)` คืนวันที่ `YYYY-MM-DD` ตามเวลาของ Machine ของ `now - 4 ชั่วโมง`
- `createBudgets({ home, registry, clock })` ที่มี `usageOf(agent)` คืน `{ day, tokens }` ของวันนี้ (ยอดของวันอื่นนับเป็น 0), `add(agent, tokens)`, `exhausted(agent)` และ `limitOf(agent)` ซึ่งเป็น `agent.budget ?? 10_000_000`
- `usageIn(text)` ฟังก์ชันเปล่าที่คืนผลรวมของสี่ field จากคำตอบเต็มก้อน: ถ้า parse เป็น JSON ได้ใช้ `usage` ของมัน ไม่งั้นอ่านทีละบรรทัด `data:` ของ SSE แล้วเก็บค่าล่าสุดของแต่ละ field จาก `message_start.message.usage` และ `message_delta.usage` คืน `undefined` เมื่อไม่มี `usage` เลย

เลือกค่าล่าสุดต่อ field ไม่ใช่บวกทุก event เพราะ `message_delta.usage.output_tokens` เป็นยอดสะสม และบาง Provider ใส่ input ซ้ำใน `message_delta`

ไม่มีตัวห่อ stream (`countUsage` ของร่างก่อน) เพราะ handler อ่านคำตอบทั้งก้อนก่อนตอบทาง IPC อยู่แล้ว ข้อความเต็มจึงพร้อมให้อ่าน `usage` โดยไม่หน่วงอะไรเพิ่ม เมื่อส่งคำตอบเป็น `llm.chunk` (ponytail ใน `proxy.ts`) ค่อยย้ายการอ่านไปทีละ chunk

`createLlmHandler` ไม่ import module นี้ รับ `allow(agent)` กับ `onUsage(agent, tokens)` เพิ่มจาก `route` และ `index.ts` ต่อเข้ากับ `createBudgets` handler จึงทดสอบด้วยค่าปลอมได้เหมือนเดิม

### ที่เก็บ: `agents.json` กับ `usage.json`

Budget เป็นค่าที่ Owner ตั้ง จึงเป็น field `budget` ของ Agent ใน `agents.json` ซึ่งเขียนผ่าน `registry.replace` ที่มีอยู่แล้ว Agent ที่ไม่มี field นี้ได้ 10M ยอดของวันนี้อยู่ใน `usage.json` ข้าง `agents.json` ใน `supervisorDir(home)` รูปร่าง `{ "<agent>": { "day": "2026-11-04", "tokens": 1234 } }` เขียนด้วย `writeJsonFile` หลังทุกคำตอบที่นับ ยอดของวันก่อนถูกเขียนทับเมื่อวันเปลี่ยน ไม่เก็บประวัติ

ทางเลือกที่ตัดออก: `bun:sqlite` ตาม ADR 0014 เพราะเก็บแค่ตัวเลขเดียวต่อ Agent และไม่มี query ย้ายเมื่อมียอดแยกตามที่มาหรือต่อ Member ต่อเดือน ซึ่งต้องเก็บประวัติ

### ตัดวันด้วยวันที่ ไม่ใช้นาฬิกา

ทุกครั้งที่อ่านหรือบวก ยอดที่เก็บไว้กับวันที่ไม่ตรง `budgetDay(clock.now())` นับเป็น 0 ไม่มี timer ตามที่ ADR 0043 กำหนด เครื่องที่ปิดข้ามวันจึงเริ่มวันใหม่ตอนเปิดเอง ใช้เวลา local ของโปรเซส ซึ่ง Bun อ่านจาก `TZ` หรือของ OS

### บังคับที่ handler ของ `llm.request` และที่ `task-message`

- **ที่ handler:** หลังตรวจ Route กับ path และก่อน `fetch` ถ้าเป็น `POST /v1/messages` และ `allow(agent)` เป็นเท็จ ตอบ `refuse(429, "budget.exhausted")` ที่เพิ่มหัว `x-should-retry: false` โดยไม่ติดต่อ Provider คำตอบนี้เป็น `llm.response` ธรรมดาทาง IPC แต่ `ipcFetch` สร้างเป็น `Response` ให้ SDK จึงต้องมี `x-should-retry: false` ไม่งั้น SDK ส่ง 429 ซ้ำอีกสองครั้ง คำขอที่ส่งไปแล้วไม่ถูกตัด เพราะ ADR 0043 ให้ Turn จบหลังคำขอที่ส่งไปแล้วตอบกลับ `count_tokens` ผ่านได้เสมอเพราะไม่มีค่าใช้จ่าย หลังได้คำตอบ ถ้า `usageIn(text)` มีค่า เรียก `onUsage`
- **ที่ worker:** ไม่แก้ adapter กับ `runTurn` ทางเดิมพา code ถึง `turn.ended` เอง การจบนี้ได้ผลเหมือน Stop ตาม ADR 0017 คือ Turn จบ ไฟล์อยู่ครบ และ Task คุยต่อได้ แต่บันทึกเป็น `reason: "error"` เพราะ Stop ยังไม่มีใน Protocol (`stop-and-restart`)
- **ที่ `task-message`:** slice รับ `exhausted` เพิ่ม ถ้า Agent นั้นหมด ตอบ error `budget.exhausted` โดยไม่ส่งถึง worker ข้อความที่ผ่านด่านนี้ได้ก่อนยอดเต็มไม่กี่มิลลิวินาที จะได้ `turn.ended` ที่มี code เดียวกันจาก handler แทน ซึ่งยอมรับได้

ทางเลือกที่ตัดออก: ข้อความ IPC ใหม่ เช่น `llm.refused` ที่ worker แปลงเป็น `LlmError` เอง ต้องแก้ทั้ง `ipc.ts`, `ipcFetch` และ adapter ทั้งที่ทาง `x-veeloe-error` ที่มีอยู่พา code ถึง Turn ได้แล้ว และใช้ status ที่ SDK ไม่ลองซ้ำ เช่น 402 แทน 429 ซึ่งไม่ต้องมีหัวเพิ่ม แต่ 429 บอกความหมายตรงกว่าเมื่ออ่าน log และ SDK รับหัว `x-should-retry` อยู่แล้ว

### ข้อความใน Protocol

- `agent.update` มี field ไม่บังคับ `budget` เป็นจำนวนเต็ม 1 ถึง 10^12 และ refine "nothing to change" นับ `budget` ด้วย slice `agents` เขียน `budget` ใน `next` ข้อความที่มีแค่ `budget` ไม่ถาม `listModels` คำตอบคือ `agent.listed` ถึงทุก Member ตามทางเดิม
- `agent.usage` (Machine → Member) body `{ agent, day, tokens, budget }` ส่งหลังทุกคำตอบที่นับ ถึงทุก Member ใน trust ซึ่งเป็นคนที่มี Manage ใน v0.1 (ADR 0034)
- Agent ใน `agent.listed` มี `budget` (ค่าจริงหลังใส่ค่าเริ่มต้น) กับ `usage: { day, tokens }` เป็น field ไม่บังคับ `listed()` ของ slice `agents` ใส่สองค่านี้จาก `budgets` Controller เก่าข้ามได้ และ Machine เก่าที่ไม่ส่งก็ไม่ทำให้ Controller ใหม่พัง (ADR 0023)
- error code ใหม่ `budget.exhausted`

ทางเลือกที่ตัดออก: ข้อความแยก `agent.budget` กับ slice ใหม่ `agent-config` ตามร่างก่อน ซึ่งเขียนไว้ตอนยังไม่มี `agent.update` ตอนนี้ `agent.update` มีการตรวจ Manage, การเขียนครั้งเดียว, การแจ้งทุก Member และทาง error บนหน้า Agent ครบแล้ว ข้อความแยกจะซ้ำทั้งหมดนั้น และ CLI `veeloe agent budget` ซึ่งไม่ตรงกับที่ ADR 0043 ให้คนที่มี Manage ตั้ง

### Controller: เก็บแล้วค่อยแสดง

migration ใหม่เพิ่มคอลัมน์ `budget`, `usage_day` และ `usage_tokens` ในตาราง `agent` `saveAgents` เปลี่ยนจาก `INSERT OR REPLACE` เป็น upsert ที่ไม่ลบคอลัมน์ที่ไม่ได้มา และ `saveUsage` ใหม่เขียนยอดเฉพาะเมื่อ `day` ใหม่กว่า หรือ `day` เดียวกันแต่ `tokens` ไม่น้อยกว่าเดิม เพราะ `agent.usage` กับ `agent.listed` มาไม่เรียงกันได้ `budget` ใช้ค่าจากซองล่าสุดเสมอ

`features/machine-link` รับ `agent.usage` ส่วนการตั้ง Budget ใช้ `updateAgent(machine, { id, budget })` ที่มีอยู่ error จึงขึ้นที่ `updateError` ของหน้า Agent โดยไม่ต้องเพิ่มชนิดของ `ref`

### หน้าจอของ Controller ตาม prototype

- **หน้า Agent** (`pages/agents/ui/AgentPage.tsx` ซึ่งมีส่วนชื่อ, Character และ Provider กับ model แล้ว) เพิ่มส่วน "Budget วันนี้" ตาม `controller-prototype/src/pages/agents/ui/AgentPage.tsx`: `Meter`, ตัวเลข "2.4M จาก 10M token (24%)" กับไอคอน `info` สีส้มที่ 80% และแดงพร้อม "หมดแล้ว" ที่ 100%, และ `Field` "Budget ต่อวัน (ล้าน token)" แบบ `decimal-pad` ปุ่มบันทึกที่หัวหน้าของหน้าส่ง `id`, `name` และ `budget` ในซองเดียวเมื่อ Budget เปลี่ยน (ส่งเฉพาะ `id` กับ `name` เมื่อ Budget ไม่เปลี่ยน) และกดไม่ได้เมื่อทั้งชื่อและ Budget ไม่เปลี่ยน ค่า Budget ไม่ถูกต้อง หรือ Machine ออฟไลน์ วางต่อจากส่วน Provider ตามลำดับของ prototype คำท้ายส่วนใช้ข้อความของ prototype
- **`Meter`** ย้ายจาก `controller-prototype/src/shared/ui/meter.tsx` และ **`formatTokens`** จาก `controller-prototype/src/shared/lib/tokens.ts` มาไว้ใน `shared/` ของ Controller ตามที่เป็น
- **รายชื่อ Agent** ตาม `controller-prototype/src/pages/agents/ui/AgentsPage.tsx`: ต่อท้ายบรรทัด Machine ด้วย "· Budget วันนี้ N%"
- **หน้าสร้าง Agent** ตาม `controller-prototype/src/pages/agents/ui/NewAgentPage.tsx`: `Note` ว่า Budget เริ่มที่ 10M token ต่อวันและตั้งทีหลังได้ที่หน้า Agent
- **หน้า Task** ตาม `controller-prototype/src/pages/task/ui/TaskPage.tsx` กรณี `budget_out`: เมื่อ item error มี code `budget.exhausted` แสดง `Card` ที่มี `Label` ไอคอน `info` สีส้ม "Budget ของวันนี้หมดแล้ว", คำว่างานใหม่เริ่มตอน 04:00 ตามเวลาของ Machine หรือเมื่อเพิ่ม Budget และไฟล์ที่แก้ไว้ยังอยู่ กับปุ่ม "เพิ่ม Budget" ที่เปิดหน้า Agent แทน `Problem` ส่วนข้อความที่ส่งไม่สำเร็จใช้คำของ `budget.exhausted` ใน `errors` ตามทางเดิม

ส่วนที่ตัดออก: เพดาน Idle Work กับ Watch และ `Note` ของมัน (ADR 0056), `budgetChanged` กับ `inform` ของ Demo, event `budget_restored` และสถานะ Task "Budget ของวันนี้หมด" ที่หัวหน้า (ต้องให้ Runtime เขียน event ลง Task เมื่อ Budget เปลี่ยน ซึ่งยังไม่คุ้ม), `UsagePage` ทั้งหน้า และการ์ด Budget ใน `MachinePage` (ADR 0052)

คำใหม่อยู่ใน i18n ของ `pages/agents` และ `pages/task` และ code ใหม่อยู่ใน `shared/i18n/errors` ทั้ง th และ en ตาม ADR 0065

## Risks / Trade-offs

- [คำตอบเดียวพายอดเกิน Budget ได้ เพราะไม่ตัดคำขอที่ส่งไปแล้ว] → เกินได้ไม่เกินหนึ่งคำตอบต่อ Task ที่คุยพร้อมกัน ซึ่ง ADR 0043 ยอมไว้ และ Budget เป็นตัวกันงานวนทั้งคืน ไม่ใช่เพดานเงิน
- [stream ที่ขาดกลางทางไม่ถูกนับ] → `upstream.text()` throw แล้ว handler ตอบ `provider.unreachable` โดยไม่มีข้อความให้อ่าน แม้ Provider อาจคิด input ไปแล้ว เกิดไม่บ่อยและ Turn จบด้วย error อยู่แล้ว จึงไม่ใช่ทางที่งานวนได้ทั้งคืน ถ้าต้องนับ ให้อ่าน body ทีละ chunk แล้วนับส่วนที่ได้ตอน throw ซึ่งมาพร้อม `llm.chunk`
- [gateway ที่ไม่ส่ง `usage` ทำให้นับเป็น 0] → Budget ไม่กันให้ คำท้ายส่วน Budget แนะนำให้ตั้ง spend limit ที่ Provider ตาม ADR 0043 และ log บรรทัดหนึ่งเมื่อคำตอบที่สำเร็จไม่มี `usage`
- [`usage.json` ถูกเขียนทุกคำตอบ] → ไฟล์เล็กและ rename ทีเดียว ถ้าโปรเซสตายระหว่างคำตอบกับการเขียน เสียการนับหนึ่งคำตอบ
- [โน้ตบุ๊กที่ย้ายเขตเวลาหรือนาฬิกาถอย] → วันสั้นหรือยาวกว่าปกติ ตาม Consequences ของ ADR 0043
- [`agent.usage` หนึ่งซองต่อคำตอบของ LLM ถึงทุก Member] → หนึ่ง Turn มีไม่เกิน 50 รอบ (`MAX_ROUNDS`) และซองเล็ก ถ้าถี่เกินค่อยส่งเฉพาะตอน Turn จบ
- [`agent.update` ที่มี `budget` กับ `model` ในซองเดียวแล้ว model ไม่ผ่าน ทำให้ Budget ไม่เปลี่ยนด้วย] → ตรงกับกฎ all-or-none ของ `agent-settings` และหน้า Agent ส่ง Budget มากับชื่อโดยไม่ส่ง model มาด้วย
