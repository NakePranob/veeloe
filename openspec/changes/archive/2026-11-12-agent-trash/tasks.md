## 1. Protocol

- [x] 1.1 เพิ่ม `AgentTrashEntrySchema` (field ของ `AgentSchema` + `deletedAt`, `restoreUntil` เป็น int nonnegative) และ `AgentRestoreBodySchema` (`{ id }`) ใน `packages/protocol-ts/src/messages/agent.ts`; ให้ `AgentListedBodySchema` มี `trash` แบบ optional
- [x] 1.2 ลงทะเบียน `agent.restore` ใน `packages/protocol-ts/src/messages/index.ts` และเพิ่ม `is_agent_restore` กับบรรทัดใน `message_is_valid` ที่ `packages/protocol/src/messages.rs`
- [x] 1.3 เพิ่ม test ว่า `agent.listed` ที่มี `trash` ครบ field ผ่าน, `trash` ที่ขาด `restoreUntil` ไม่ผ่าน, `agent.restore` ที่ไม่มี id ไม่ผ่าน, และ `agent.listed` รุ่นเก่าที่ไม่มี `trash` ยังผ่าน
- [x] 1.4 ตรวจ `bun run check:protocol`

## 2. Runtime: registry

- [x] 2.1 เพิ่ม `pub deleted_at: Option<i64>` (`#[serde(rename = "deletedAt", default, skip_serializing_if = "Option::is_none")]`) ใน `Agent` และ `pub const TRASH_DAYS: u64 = 30` ใน `packages/runtime/crates/runtime-supervisor/src/agents.rs`
- [x] 2.2 เพิ่ม `AgentRegistry::{soft_delete(id, now_ms), restore(id), purge_expired(now_ms)}` โดย `purge_expired` ลบเฉพาะแถวที่ `deleted_at + 30 วัน <= now_ms` และคืนจำนวนแถวที่ลบ
- [x] 2.3 เพิ่ม test ว่า soft delete ทำให้ `get` ยังเจอ Agent พร้อม `deleted_at`, restore ล้างค่า, purge ที่ 29 วันไม่ลบ, purge ที่ 30 วันพอดีลบ และโฟลเดอร์ `<home>/agents/<id>` ยังอยู่หลัง purge
- [x] 2.4 ตรวจ `cd packages/runtime && cargo test -p veeloe-runtime-supervisor agents`

## 3. Runtime: dispatch และ process

- [x] 3.1 เปลี่ยน `agents_listed()` ให้ใส่ `agents` เฉพาะ `deleted_at.is_none()` และเพิ่ม `trash` จากแถวที่เหลือ พร้อม `deletedAt` กับ `restoreUntil` (`deleted_at + TRASH_DAYS`)
- [x] 3.2 เปลี่ยน `agent.delete` ให้เรียก `soft_delete` แทน `remove` โดยยัง `workers.stop` และ `routes.forget` ก่อน, ถ้า Agent มี `deleted_at` อยู่แล้วให้ตอบ `agent.listed` โดยไม่เขียนอะไร (ไม่เลื่อนวันหมดอายุ), และ log type `agent.trash`; ให้ `agent.update` ที่เล็ง Agent ในถังขยะตอบ `agent.unknown`
- [x] 3.3 เพิ่ม `agent.restore` ใน `dispatch`: เรียก `purge_expired(now)` ก่อน, ถ้าไม่เจอหรือหมดอายุแล้วตอบ `agent.unknown`, ถ้าเจอแต่ยังไม่ถูกกักตอบ `agent.listed` เฉย ๆ, ถ้ากำลังถูกกักให้ `restore` แล้ว `workers.start` และ log `agent.restore`
- [x] 3.4 กัน `task.message`, `task.sync` และ `task.stop` ที่เล็ง Agent ที่มี `deleted_at` ให้ตอบ `agent.unknown` ก่อนถึง worker
- [x] 3.5 `on_ready()` ใน `packages/runtime/crates/runtime-supervisor/src/main.rs` ข้าม Agent ที่มี `deleted_at`; proxy `allow` คืน false ให้ Agent นั้น; เรียก `purge_expired` ตอนบูตก่อนสตาร์ท worker
- [x] 3.6 เพิ่ม test ใน `tests/agent_slices.rs` ว่า delete แล้ว `agents` ว่างแต่ `trash` มีหนึ่งรายการพร้อม `restoreUntil`, delete ซ้ำแล้ว `deletedAt` ไม่เปลี่ยน, restore แล้วกลับมาอยู่ `agents` และ `trash` ว่าง, restore ซ้ำไม่เปลี่ยนอะไร, create ด้วย id ที่อยู่ในถังขยะได้ `agent.exists`, `agent.update` ไปยัง Agent ในถังขยะได้ `agent.unknown`, และ `task.message` ไปยัง Agent ในถังขยะได้ `agent.unknown`
- [x] 3.7 ตรวจ `cd packages/runtime && cargo test -p veeloe-runtime-supervisor`
- [x] 3.8 ให้ `machine.status` นับเฉพาะ Budget ของ Agent ที่ใช้งานอยู่ ไม่รวม Agent ในถังขยะ และเพิ่ม test ว่า `task.sync`/`task.stop` ของ Agent ในถังขยะได้ `agent.unknown`, restore ที่หมดอายุผ่าน `dispatch` ได้ `agent.unknown` พร้อม purge

## 4. Controller: ข้อมูล local

- [x] 4.1 เพิ่ม migration ต่อท้าย `controller/src/shared/db/migrations.ts`: `CREATE TABLE agent_trash (id TEXT PRIMARY KEY NOT NULL, machine_id TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, deleted_at INTEGER NOT NULL, restore_until INTEGER NOT NULL)` พร้อม comment ว่าอ้าง `agent-trash`
- [x] 4.2 เปลี่ยน `saveAgents(database, machineId, agents, trash)` ใน `controller/src/entities/agent/model/agents.ts` ให้ upsert `agent` และ `agent_trash` แยกกัน, ลบแถวที่หายจากลิสต์ของแต่ละตาราง, ลบ `agent_trash` แถวที่ id ไปปรากฏใน `agents`, และล้าง `agent_trash` ของ Machine เมื่อ `trash` เป็น `undefined`
- [x] 4.3 เพิ่ม `USED_TRASH_AGENTS` กับ `useTrashedAgents()` ใน `controller/src/entities/agent/model/use-agents.ts` และ export จาก `index.ts` โดยให้ `LIST_AGENTS` ของเดิมไม่เปลี่ยน
- [x] 4.4 เพิ่ม test ว่า delete (agents ว่าง + trash มีแถว) ย้ายข้อมูลไป `agent_trash`, restore (agents มีแถว + trash ว่าง) ย้ายกลับ, `trash: undefined` ล้างถังขยะของ Machine นั้น, และถังขยะของ Machine อื่นไม่ถูกแตะ
- [x] 4.5 ตรวจ `cd controller && bun test ./src`
- [x] 4.6 เก็บ `character` ของ Agent ที่ถูกลบลงตาราง `agent_trash` (migration `ALTER TABLE agent_trash ADD COLUMN character TEXT`) และ test ว่า JSON เดิมยังอยู่เมื่อ Machine ไม่ส่ง Character มา

## 5. Controller: action และ UI

- [x] 5.1 เพิ่ม `restoreAgent(machine, id)` ใน `controller/src/features/machine-link/model/links.ts` ที่ส่ง `agent.restore` และเพิ่ม `restoreError` ใน status; ส่ง `message.body.trash` เข้า `saveAgents` ที่ตัวรับ `agent.listed`
- [x] 5.2 เพิ่ม section "Agent ที่ถูกลบ" ใต้รายการใน `controller/src/pages/agents/ui/AgentsPage.tsx` ด้วย `Section` กับ `Row` เดิม: แสดงชื่อ, ชื่อ Machine, "เหลือ N วัน" และปุ่มกู้คืนพร้อม `confirm`; ไม่มี section เมื่อ `useTrashedAgents()` ว่างหรือ Machine ไม่ส่ง `trash`
- [x] 5.3 เพิ่ม i18n th/en ใน `controller/src/pages/agents/i18n/` สำหรับหัวข้อ section, คำอธิบาย, จำนวนวันที่เหลือ, ปุ่มกู้คืน, confirm และข้อความเมื่อกู้คืนไม่สำเร็จ
- [x] 5.4 ให้ `controller/src/pages/task/ui/TaskPage.tsx` หา Agent จาก `useTrashedAgents()` เมื่อไม่พบใน `useAgents()` เพื่อใช้ชื่อ, Machine และ Character จริง โดยยัง `readOnly` และไม่แสดง composer
- [x] 5.5 เพิ่ม test ว่า `restoreAgent` ส่ง frame `agent.restore` พร้อม body ถูกต้อง, `agent.listed` ที่มี `trash` เรียก `saveAgents` ด้วย trash, และการนับวันเหลือจาก `restoreUntil` ไม่ติดลบ
- [x] 5.6 ตรวจ `cd controller && bun test ./src && cd .. && bun run check:controller`
- [x] 5.7 แสดง Character ในแถวถังขยะผ่าน `Row` prop `leading` (ไม่สร้าง component ใหม่) และกัน `daysLeft` ไม่ให้เกินหน้าต่าง 30 วันเมื่อนาฬิกาเครื่องกับ Machine ต่างกันไม่กี่มิลลิวินาที

## 6. เอกสารและขอบเขต

- [x] 6.1 เพิ่ม "การกู้คืน Agent ที่ลบภายใน 30 วัน" ในบรรทัด v0.2 ของ `docs/adr/0048-five-phases-with-v0-1-as-the-mvp.md` และเพิ่ม bullet ใต้ v0.2 ใน `docs/roadmap.md` ว่า change นี้ร่างไว้แล้วและรอคิวหลัง v0.1
- [x] 6.2 ตรวจว่าไม่มี trailing whitespace และไม่มีอักษรนอกภาษาใน change: `grep -rn '[[:space:]]$' openspec/changes/agent-trash` และ `rg -n '[\p{Cyrillic}\p{Hiragana}\p{Katakana}]' openspec/changes/agent-trash`

## 7. ตรวจบนเครื่องจริง

- [x] 7.1 บน Android emulator: ลบ Agent ที่มี Task → อยู่ในถังขยะพร้อมวันเหลือ, ปิด/เปิดแอปแล้วยังอยู่, กดกู้คืน → กลับไปรายการหลักและ Task เดิมคุยต่อได้ (ทดสอบแล้วบน veeloe-qa: `agent.trash` → `agent.restore`, Task เดิมยังอ่านได้พร้อมชื่อจริง และส่งต่อได้หลังกู้คืน)
- [x] 7.2 ทดสอบ purge ด้วย Runtime จริงบน macOS: แก้ `deletedAt` ใน `agents.json` ให้ย้อนหลัง 31 วัน แล้วให้แอปขอ `agent.list` ใหม่ → Log มี `agent.purge` (1 แถว), Agent หายจาก `trash`, `agents.json` ว่าง และโฟลเดอร์ Agent พร้อม `tasks.db`/`workdir` ยังอยู่
