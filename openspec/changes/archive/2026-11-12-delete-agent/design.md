## Context

- `packages/runtime/crates/runtime-supervisor/src/agents.rs` มี `AgentRegistry::remove`
- `packages/runtime/crates/runtime-supervisor/src/workers.rs` ยังไม่มี `stop(id)`
- `packages/runtime/crates/runtime-supervisor/src/task_routes.rs` มี `prune(agent_ids)` แต่ไม่มี `forget(agent)`
- `packages/protocol-ts/src/messages/agent.ts` มี `agent.create`, `agent.update`, `agent.list`
- `controller/src/pages/agents/ui/AgentPage.tsx` ยังไม่มีปุ่มลบ
- `controller/src/entities/agent/model/agents.ts` เขียน comment ว่า v0.1 ไม่ลบ Agent และ `saveAgents` ไม่ลบแถวที่หายไป

## Terminology

- **Agent deletion** คือการเอา Agent ออกจาก registry/worker/route ของ Machine และออกจากรายการ Controller
- **Workdir** คือโฟลเดอร์ `<VEELOE_HOME>/agents/<id>/workdir` (ADR 0032)
- **Task history** คือ event log ของ Task ที่ยังเก็บใน `tasks.db` ของ Machine

## Decisions

### 1. เก็บ Workdir และ Task history

**Decision:** ลบ Agent ออกจาก registry/worker/route แต่ไม่ลบ Workdir และไม่ลบ Task history

**Why:** การลบไฟล์หรือประวัติเป็น irreversible และไม่มี backup ใน v0.1; Owner ลบ Agent เพื่อเลิกใช้งาน ไม่ได้แปลว่าต้องการทำลายหลักฐาน

**Rejected:** ลบ Workdir ตาม — เสี่ยงข้อมูลหายและต้องมีคำเตือน/backup ที่ยังไม่มี

**Rejected:** ลบ Task history ตาม — ทำให้เปิด Task เดิมไม่ได้และขัด ADR 0005 ที่ประวัติอยู่บน Runtime

### 2. ต้องมี Manage หรือ Owner

**Decision:** `agent.delete` ใช้ authorization เดียวกับ `agent.update`: Owner ผ่านทุก Agent; Member ต้องมี `manage` ที่ Agent นั้น

**Why:** การลบ Agent หยุดงานและทำให้คนอื่นใช้ Agent ไม่ได้; เป็นสิทธิ์ระดับ Manage

### 3. หยุด worker ก่อนลบ registry

**Decision:** `Workers::stop(id)` ตัด sender/worker ของ Agent, แล้ว `AgentRegistry::remove`, แล้ว `TaskRoutes::forget`

**Why:** ถ้าลบ registry ก่อน worker อาจมีงานค้างส่งถึง Agent ที่ไม่มีอยู่; การตัด channel ทำให้ worker จบเอง

### 4. Controller ลบแถว local เมื่อ Machine ตอบ

**Decision:** `agent.delete` ไม่ลบ local ทันที; รอ `agent.listed` ที่ไม่มี id นั้นแล้ว `saveAgents` ลบแถวของ Machine ที่หายไป

**Why:** ข้อมูลจริงอยู่ที่ Machine (ADR 0006); Controller ไม่ควรเดาผลก่อน Machine ยืนยัน

## API

```json
{ "type": "agent.delete", "body": { "id": "a_..." } }
```

Machine ตอบด้วย `agent.listed` ตามปกติ

## Risks

- ถ้า Agent มี Turn กำลังทำ การหยุด worker จะทำให้ Turn จบแบบ interrupted; ต้องเตือนใน UI
- Task ที่ค้างอยู่ยังเปิดได้แต่ Agent หาย; หน้า Task ต้องไม่ crash เมื่อหา Agent ไม่เจอ
- Workdir ที่เก็บไว้อาจกินพื้นที่; ผู้ใช้ลบเองได้

## Open decisions

- จะมีปุ่ม "ลบ Workdir ด้วย" ในอนาคตหรือไม่
