## Context

- `packages/runtime/crates/runtime-supervisor/src/agents.rs` — `Agent` struct, `AgentRegistry::{all,get,add,replace,remove,save}`, `agent_dir()`
- `packages/runtime/crates/runtime-supervisor/src/tasks.rs` — `agents_listed()` (บรรทัด ~106), `agent.list`, `agent.delete` (~406), `agent.create`/`agent.update` (~430), `task.message` (~540), `Machine` struct
- `packages/runtime/crates/runtime-supervisor/src/main.rs` — `on_ready()` สตาร์ท Worker ทุก Agent (~258), proxy `allow` ที่อ่าน registry (~1124)
- `packages/runtime/crates/runtime-supervisor/src/workers.rs` — `Workers::{start,stop,rename}` (138)
- `packages/runtime/crates/runtime-supervisor/src/task_routes.rs` — `TaskRoutes::forget` ที่ `agent.delete` เรียกอยู่แล้ว
- `packages/protocol-ts/src/messages/agent.ts` — `AgentSchema`, `AgentListedBodySchema`, `AgentDeleteBodySchema`
- `packages/protocol-ts/src/messages/index.ts` — ทะเบียน message type
- `packages/protocol/src/messages.rs` — `is_agent_delete` และ `message_is_valid`
- `controller/src/shared/db/migrations.ts` — migration แบบ append-only, `user_version` นับจำนวน entry
- `controller/src/entities/agent/model/agents.ts` — `AgentRow`, `LIST_AGENTS`, `saveAgents()`
- `controller/src/entities/agent/model/use-agents.ts` — `useAgents()` ใช้ `LIST_AGENTS`
- `controller/src/features/machine-link/model/links.ts` — ตัวรับ `agent.listed` (~216), `deleteAgent()` (~400)
- `controller/src/pages/agents/ui/AgentsPage.tsx` — รายการ Agent ปัจจุบัน
- `controller/src/pages/task/ui/TaskPage.tsx` — `placeholderAgent()` (~146) และ `readOnly` เมื่อหา Agent ไม่เจอ (~171-176)
- `controller/src/shared/ui/forms.tsx` — `Section`, `Row` ที่จะใช้กับ section ถังขยะ
- `controller/src/pages/agents/i18n/{th,en}.json`, `controller/src/pages/task/i18n/{th,en}.json`

## Terminology

- **Agent ที่ถูกลบ (trashed Agent)** คือ Agent ที่ยังมีแถวอยู่ใน `agents.json` แต่มี `deletedAt` ไม่เป็น null; Worker ไม่ทำงาน และไม่รับ Task ใหม่
- **`deletedAt`** คือเวลาที่ลบ เป็น epoch milliseconds ตามนาฬิกาของ Machine
- **`restoreUntil`** คือ `deletedAt + 30 วัน` เป็น epoch milliseconds; Runtime เป็นผู้คำนวณและส่งมา ไม่ให้ Controller คิดเอง
- **Purge** คือการเอาแถวออกจาก `agents.json` เมื่อพ้น `restoreUntil`; ไม่แตะ Workdir และ `tasks.db`
- **Workdir** คือ `<VEELOE_HOME>/agents/<id>/workdir` (ADR 0032); **Task history** คือ event log ใน `<VEELOE_HOME>/agents/<id>/tasks.db`
- **`Agent ที่ใช้งานอยู่`** คือแถวที่ `deletedAt` เป็น null

## Decisions

### 1. เก็บสถานะลบไว้บนแถวเดิมใน `agents.json`

**Decision:** เพิ่ม field `deletedAt` (optional, epoch ms) ใน `Agent` และเก็บแถวไว้แทนการ `remove`; `soft_delete(id, now)` เขียนค่า, `restore(id)` ล้างค่า, `purge_expired(now)` เอาแถวที่ `deletedAt + 30 วัน <= now` ออก

**Why:** `agents.json` เป็นแหล่งความจริงเดียวของ Agent อยู่แล้ว (ADR 0006, one writer); การกู้คืนคือการล้าง field เดียว และ purge คือการลบแถวเหมือนโค้ดเดิม — ไม่มีข้อมูลสองชุดให้ซิงก์กัน และ Task history ที่ผูกกับ id ยังใช้ได้ทันทีหลังกู้คืน

**Rejected:** ไฟล์ `agents-trash.json` แยก — ต้องมีสองแหล่งความจริง, กู้คืนต้องย้ายแถวข้ามไฟล์ และมีโอกาสแถวซ้ำ id

**Rejected:** ย้ายโฟลเดอร์ `<home>/agents/<id>` ไปถังขยะของระบบไฟล์ — ขัด non-goal ที่ไม่แตะ Workdir และทำให้ path ของ Task history เปลี่ยน

### 2. `agent.listed` แยก `agents` กับ `trash` ไม่ใส่ Agent ที่ถูกลบปนใน `agents`

**Decision:** `agents` มีเฉพาะ Agent ที่ใช้งานอยู่ (รูปเดิมทุกประการ) และเพิ่ม `trash` เป็น array ของ entry ที่มี field ของ Agent บวก `deletedAt`, `restoreUntil`

**Why:** Controller รุ่นเก่าใช้ `agents` เพื่อลบแถว local ที่หายไป (`saveAgents`) ถ้าใส่ Agent ที่ถูกลบลงใน `agents` แอปรุ่นเก่าจะแสดงมันเป็น Agent ปกติและสั่งงานไม่ได้ ส่วน field ใหม่ที่รุ่นเก่าไม่รู้จักจะถูกเมินตาม ADR 0023 จึงปลอดภัยทั้งสองทาง

**Rejected:** ใส่ `deletedAt` ใน `agents` แล้วให้ Controller กรองเอง — แอปรุ่นเก่าที่ติดตั้งอยู่จะโชว์ Agent ที่ลบแล้วเป็น Agent ที่ใช้งานได้

**Rejected:** message ใหม่ `agent.trash` แยก — ต้องมี request/response อีกชุดและต้องขอซ้ำหลังทุก action; การพ่วง `trash` ใน `agent.listed` ให้ข้อมูลครบในคำตอบเดียว

### 3. Purge คำนวณตอนอ่าน ไม่มี timer

**Decision:** เรียก `purge_expired(now)` ตอน supervisor เริ่มทำงาน และก่อนสร้าง `agent.listed` ทุกครั้ง

**Why:** ไม่ต้องมีงานเบื้องหลังที่ต้องรอดเวลา ไม่มี state ที่ต้องกู้เมื่อเครื่องหลับ และผลลัพธ์เหมือนกันไม่ว่าจะเปิดแอปตอนไหน; 30 วันเป็นค่าคงที่ `TRASH_DAYS = 30` ฝั่ง Runtime

**Rejected:** timer ต่อ Agent — ต้องจัดการเมื่อ service ถูกปิดกลางคัน และมี thread เพิ่มโดยไม่ได้อะไร

**Rejected:** ให้ Controller เป็นคนบอกให้ purge — Controller ไม่ควรเป็นเจ้าของข้อมูลบน Machine (ADR 0006)

### 4. กู้คืนแบบ idempotent และหมดอายุแล้วตอบ `agent.unknown`

**Decision:** `agent.restore` กับ Agent ที่มีอยู่และยังไม่ถูกกัก → ตอบ `agent.listed` โดยไม่เปลี่ยนอะไร; กับ Agent ที่หมดอายุ → purge แล้วตอบ `agent.unknown`; กับ id ที่ไม่รู้จัก → `agent.unknown`

**Why:** ปุ่มกดซ้ำหรือคำตอบที่หายระหว่างทางต้องกู้คืนซ้ำได้โดยไม่เกิด error ที่ผู้ใช้แก้ไม่ได้; การแยก "หมดอายุ" ออกจาก "ไม่มี" ไม่ได้ให้ข้อมูลอะไรเพิ่มกับผู้ใช้ เพราะทั้งคู่จบที่ "กู้คืนไม่ได้แล้ว"

### 5. id ที่อยู่ในถังขยะยังถูกจอง

**Decision:** `agent.create` ด้วย id ที่ยังอยู่ในถังขยะตอบ `agent.exists` เหมือนมี Agent อยู่

**Why:** แถวและโฟลเดอร์ยังอยู่จริง; ปล่อยให้ create ทับจะทำให้ settings เก่าถูกเขียนทับและ Task history เก่าไปผูกกับ Agent ใหม่โดยไม่มีใครตั้งใจ

**Rejected:** ให้ `agent.create` ปลดล็อกจากถังขยะเป็นนัย — ทำให้ "กู้คืน" กับการ "สร้างใหม่" ปนกันและไม่มีที่ให้บอกผู้ใช้ว่าเกิดอะไรขึ้น

### 5.1 ลบซ้ำไม่เลื่อนเวลา และแก้ setting ของ Agent ในถังขยะไม่ได้

**Decision:** `agent.delete` ที่เล็ง Agent ซึ่งมี `deletedAt` อยู่แล้วไม่เขียนอะไรและไม่เลื่อนวันหมดอายุ; `agent.update` ที่เล็ง Agent ในถังขยะตอบ `agent.unknown`

**Why:** ปุ่มลบที่กดซ้ำหรือคำขอที่ replay ต้องไม่ต่ออายุถังขยะให้ยาวขึ้นโดยไม่ตั้งใจ และหน้าจอที่ค้างอยู่ของ Controller ไม่ควรแก้ setting ของ Agent ที่ผู้ใช้เห็นว่าถูกลบไปแล้ว

**Rejected:** ปล่อยให้ `agent.update` ทำงานกับ Agent ในถังขยะ — ผู้ใช้จะไม่เห็นผลและอาจได้ setting ที่เปลี่ยนไปหลังกู้คืนโดยไม่รู้ตัว

### 6. Controller เก็บถังขยะในตาราง `agent_trash` แยกจาก `agent`

**Decision:** migration ใหม่สร้างตาราง `agent_trash (id, machine_id, name, provider, model, deleted_at, restore_until)` และเพิ่มคอลัมน์ `character` (JSON) ใน migration ถัดมา ให้ section ถังขยะแสดงรูปได้เหมือนรายการหลัก; `saveAgents(database, machineId, agents, trash)` เขียนทั้งสองตาราง และ `useTrashedAgents()` อ่านเฉพาะตารางนี้

**Why:** มี 12 ไฟล์ที่เรียก `useAgents()` (Inbox, หน้า Machine, การใช้ token, Allowlist, Character, Task) ถ้าใส่ `deleted_at` ลงตาราง `agent` ต้องไล่กรองทุกจุดและมีโอกาสลืม; การแยกตารางทำให้ Agent ที่ถูกลบไม่โผล่ในที่ที่ไม่ควรโผล่เลยโดยไม่ต้องแก้ผู้เรียกเดิม

**Rejected:** เพิ่มคอลัมน์ `deleted_at` ในตาราง `agent` — blast radius กว้างและเสี่ยง Agent ที่ลบแล้วโผล่ในหน้า Task/Inbox/Budget

**Rejected:** เก็บถังขยะไว้ใน memory ของ `links.ts` — หายเมื่อปิดแอป และขัด local-first

### 7. `trash` ที่หายไปจากคำตอบ = ล้างถังขยะของ Machine นั้น

**Decision:** ถ้า `agent.listed` ไม่มี field `trash` เลย ให้ `saveAgents` ลบแถว `agent_trash` ของ Machine นั้นทั้งหมด

**Why:** field นี้ขาดได้ทางเดียวคือ Machine รุ่นเก่าที่ลบแบบถาวร (หรือเครื่องที่ถูก pair ใหม่กับ Runtime เก่า) การเก็บแถวค้างไว้จะแสดงปุ่มกู้คืนที่กดแล้วได้ `agent.unknown` — แย่กว่าการลบข้อมูลที่ใช้ไม่ได้แล้วทิ้ง

**Rejected:** คงแถวเดิมไว้เหมือน `egress` — `egress` ที่ค้างเป็นแค่ค่าตั้งที่ไม่ตรงความจริง แต่ถังขยะที่ค้างคือปุ่มที่กดแล้วไม่สำเร็จ

### 8. หน้า Task ของ Agent ในถังขยะใช้ชื่อจริง

**Decision:** `TaskPage` หา Agent จาก `useAgents()` ก่อน; ถ้าไม่พบ ให้หาใน `useTrashedAgents()` เพื่อใช้ชื่อ, Machine และ Character; ยังคง `readOnly` เหมือนเดิม

**Why:** ข้อความ "Agent ที่ถูกลบ" แบบกลาง ๆ ทำให้ผู้ใช้แยกไม่ออกว่า Task ไหนเป็นของใคร และข้อมูลชื่อมีอยู่แล้วในถังขยะ; ไม่เปลี่ยนกฎว่าแก้หรือสั่งงานไม่ได้จนกว่าจะกู้คืน

### 9. Agent ในถังขยะไม่ถูกสตาร์ทและไม่ถูกใช้เป็นเส้นทาง LLM

**Decision:** `Workers::start` ไม่สตาร์ท Agent ที่มี `deletedAt` (จึงครอบทั้งตอน boot และตอนกู้คืน); proxy `allow` คืน false ให้ Agent นั้น; `task.message`, `task.sync` และ `task.stop` ที่เล็ง Agent ในถังขยะตอบ `agent.unknown` ก่อนถึง worker; และ `machine.status` ไม่นับ Budget ของ Agent ในถังขยะ

**Why:** แถวที่ยังอยู่ใน registry จะถูกมองว่า "มี Agent" โดยโค้ดเดิมทุกที่; ถ้าไม่กันไว้ การส่งงานจะไปจบที่ `agent.unavailable` ซึ่งบอกผู้ใช้ผิดว่า Machine มีปัญหา

## API

```json
{ "type": "agent.delete", "body": { "id": "a_..." } }
```

```json
{ "type": "agent.restore", "body": { "id": "a_..." } }
```

`agent.listed` (ตอบ `agent.list`, `agent.delete`, `agent.restore`, `agent.create`, `agent.update`):

```json
{
  "agents": [ { "id": "a_live", "name": "Deployer", "provider": "main", "model": "model-a" } ],
  "trash": [
    {
      "id": "a_gone",
      "name": "Old Deployer",
      "provider": "main",
      "model": "model-a",
      "deletedAt": 1794000000000,
      "restoreUntil": 1796592000000
    }
  ],
  "providers": [],
  "egress": []
}
```

- `trash` เป็น optional: Machine รุ่นก่อน change นี้ไม่ส่งมา
- `deletedAt` และ `restoreUntil` เป็น epoch milliseconds
- `agent.restore` ไม่มี body อื่นนอกจาก `id`

## Risks

- นาฬิกาของ Machine ถูกปรับย้อนหลังหรือไปข้างหน้า จะทำให้วันเหลือที่แสดงคลาดเคลื่อนและ purge เร็ว/ช้า; Runtime คิดจากนาฬิกาเครื่องตัวเองทั้งสองฝั่ง จึงไม่มีการเทียบข้ามเครื่อง
- Runtime รุ่นเก่าที่ pair ใหม่จะไม่มี `trash` ทำให้ Controller ล้างถังขยะของ Machine นั้น (ตั้งใจ) แต่ผู้ใช้จะเห็น Agent หายจากถังขยะโดยไม่ได้กดอะไร
- purge ไม่ลบไฟล์ตาม non-goal ทำให้พื้นที่ใน `<home>/agents/<id>` โตต่อไปจนเจ้าของเครื่องลบเอง
- Controller รุ่นเก่าจะไม่เห็นถังขยะจนกว่าจะอัปเดตแอป; ระหว่างนั้น Agent ที่ลบแล้วหายจากรายการเหมือนเดิม
- สอง Controller กดกู้คืนพร้อมกัน: คำขอที่สองเป็น no-op และได้ `agent.listed` ล่าสุด ไม่มีทางสร้างแถวซ้ำเพราะ id เป็น key เดียว
- Turn ที่ค้างตอนลบไม่กลับมาทำต่อหลังกู้คืน (worker ถูก stop และ route ถูก forget) — ต้องบอกในข้อความยืนยันการลบ

## Open decisions

- ประวัติการใช้ token ของ Agent ที่ถูกลบจะแสดงที่ไหน (ข้อเสนอ: ซ่อนไปกับ Agent จนกว่าจะมี change แยก)
- จะเพิ่มหน้า Agent ที่ถูกลบแบบอ่านอย่างเดียว (ดู Character, settings เดิม, Task ทั้งหมด) ใน phase ไหน
- ถ้าต้องการให้ Inbox แสดง Agent ที่ถูกลบด้วย ต้องตัดสินร่วมกับ ADR 0060 (ขอบเขตการเปิดดู Task) ก่อน
