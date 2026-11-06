## Why

Agent คุยกับ Provider จริงผ่าน supervisor ได้แล้ว และหลัง `sandboxed-commands` ก็รัน bash ได้ แต่ไม่มีอะไรกันไม่ให้ token หมดไปเองทั้งคืน ไม่ว่าจะเป็น tool ที่วนไม่จบ หรือ Owner ที่ส่งงานหนักไว้แล้ววางมือถือ ค่า token เข้า key ของลูกค้าเอง (ADR 0001) change นี้จึงทำ Budget ต่อวันตาม ADR 0043 ที่ handler ของ `llm.request` ใน supervisor ซึ่งเป็นที่เดียวที่คำขอออกไป Provider (ADR 0042) ก่อนที่ Agent จะมี Schedule

## What Changes

- handler ของ `llm.request` (`createLlmHandler`) อ่าน `usage` ของทุกคำตอบจาก `POST /v1/messages` ทั้งแบบ JSON และ SSE จากข้อความเต็มที่อ่านไว้แล้ว แล้วบวกเข้ายอดของ Agent ในวันนั้น นับ input, input ที่เขียนและอ่านจาก cache และ output ยอดเป็นของ Agent ไม่ว่า Task ตรึง Provider หรือ model ไหนไว้
- วันของ Budget เริ่มตอน 04:00 ตามเวลาของ Machine supervisor เก็บยอดตามวันที่ใน `usage.json` ข้าง `agents.json` ไม่ตั้งนาฬิกาไปรีเซ็ต
- Agent ทุกตัวมี Budget ค่าเริ่มต้น 10M token ต่อวัน เก็บเป็น field `budget` ใน `agents.json` Agent ที่สร้างก่อน change นี้ได้ค่าเริ่มต้น
- เมื่อยอดถึง Budget handler ตอบ `llm.request` ถัดไปด้วยคำปฏิเสธของ supervisor ที่มี `x-veeloe-error: budget.exhausted` และ `x-should-retry: false` worker จึงจบ Turn ด้วย code นี้ทางเดิมโดยไม่แก้ worker และ supervisor ปฏิเสธ `task.message` ใหม่ด้วย code เดียวกันโดยไม่ส่งถึง worker
- Protocol: `agent.update` มี field ไม่บังคับ `budget` ให้ Owner ตั้ง Budget, ข้อความใหม่ `agent.usage` จาก Machine ที่บอกยอดของวันนี้กับ Budget และ `agent.listed` พก `budget` กับ `usage` ของแต่ละ Agent แบบ additive
- Controller แสดง Budget วันนี้เป็นแถบกับตัวเลขบนหน้า Agent ให้ Owner ตั้ง Budget ได้ที่นั่น แสดงเปอร์เซ็นต์ในรายชื่อ Agent และแสดงการ์ดเมื่อ Budget หมดใน Task พร้อมปุ่มไปเพิ่ม Budget

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities
- `runtime-providers`: proxy นับ token, วันของ Budget และการบังคับเมื่อ Budget หมด
- `runtime-agents`: `agent.listed` พก `budget` กับ `usage` และ `agent.usage` ระหว่างใช้
- `agent-settings`: `agent.update` ตั้ง `budget` ได้และมีผลทันที, Controller เก็บยอด และส่วน Budget บนหน้า Agent
- `controller-tasks`: การ์ดเมื่อ Budget หมดในหน้า Task

## Impact

- **โค้ดใหม่:** module ร่วม `packages/runtime/src/supervisor/budget/` (ยอดต่อวัน, การตัดวัน, ตัวอ่าน `usage` จากข้อความเต็ม) ที่ `index.ts` ต่อเข้ากับ handler, slice `task-message` และ slice `agents`
- **แก้:** `supervisor/proxy/proxy.ts` นับและปฏิเสธ, `supervisor/agents/agents.ts` รับ `budget` ใน `agent.update` และใส่ `budget` กับ `usage` ใน `agent.listed`, `supervisor/task-message`, `packages/protocol/src/messages/agent.ts` (`budget` ใน `agent.update`, `agent.usage`), `controller/src/entities/agent` กับ migration ใหม่, `features/machine-link`, `pages/agents`, `pages/task` และคำของ code ใหม่ใน `shared/i18n/errors`
- **ไม่แก้:** worker (`ipc.ts`, `ipcFetch`, adapter, `runTurn`) และกฎ dependency-cruiser
- **Dependency ใหม่:** ไม่มี
- **Hub:** ไม่แตะ
- **ยังไม่รวม:** push ตอนใช้ถึง 80% และตอนหมด (`push-notifications`, ADR 0044), ราคาโดยประมาณเป็นเงิน, ยอดแยกตามที่มา (v0.1 มีแค่ Task), ยอดต่อ Member ต่อเดือน (v0.1 มี Owner คนเดียว), เพดานของ Idle Work กับ Watch (ADR 0056, v0.2), การตั้ง Budget จาก CLI และหน้ารวมการใช้ token (`UsagePage`)
