## Context

- `packages/runtime/crates/runtime-core/src/memory.rs` — `MEMORY_LIMIT`, อ่าน `MEMORY.md` แล้วตัดเพดาน; `read_memory` เป็นตัวอ่านตัวเดียว ทั้ง prompt, คำสั่ง CLI และข้อความ `memory.got` ใช้ร่วมกัน
- `packages/runtime/crates/runtime-supervisor/src/memory.rs` — คำสั่ง `veeloe memory <agent>` ที่อ่านผ่าน `read_memory` และ `agents::agent_root`
- `packages/runtime/crates/runtime-supervisor/src/tasks.rs` — `dispatch()` ที่รับข้อความจาก Member และตัวช่วย `outbox.to_member()` / `outbox.error()`
- `packages/runtime/crates/runtime-supervisor/src/agents.rs` — `AgentRegistry`, `agent_root(home, id)`, `Agent::deleted()`
- `packages/protocol-ts/src/messages/index.ts` — ทะเบียน message type; รูปแบบ request/answer ที่มีอยู่คือ `usage.list` → `usage.listed`, `task.list` → `task.listed`
- `packages/protocol-ts/src/messages/usage.ts` — รูปแบบ `request` ที่ echo กลับเพื่อทิ้งคำตอบเก่า
- `packages/protocol/src/messages.rs` — `message_is_valid` และ validator ต่อชนิด
- `controller/src/features/machine-link/model/links.ts` — `requestUsage()`, `usageStatuses`, ตัวรับ `usage.listed`, การทิ้งคำตอบที่ request ไม่ตรง
- `controller/src/pages/agents/ui/AgentPage.tsx` — `Section` กับ `Row href` ที่เป็นทางเข้า Character, Allowlist, Model
- `controller/src/app/agents/[agent]/{index,character,allowlist,model}.tsx` — รูปแบบ route ลูกของ Agent
- `controller/src/pages/usage/` — หน้าที่ดึงข้อมูลจาก Machine แล้วแสดงเวลาที่ได้ล่าสุด (ต้นแบบการจัดการสถานะ)
- `controller/src/pages/task/ui/TaskPage.tsx` — การแสดง log แบบข้อความล้วน
- `controller/src/shared/ui/` — `Screen`, `Section`, `Row`, `Note`, `Empty`, `Text`, `Card`

## Terminology

- **Memory** คือ `MEMORY.md` ที่ root ของ Workdir (`<VEELOE_HOME>/agents/<id>/workdir/MEMORY.md`) ตาม ADR 0036
- **Cap** คือเพดาน 4,000 ตัวอักษร นับเป็น Unicode scalar ตาม `MEMORY_LIMIT`
- **`text`** คือข้อความที่ Turn ถัดไปได้รับจริง: ตัวแรกไม่เกิน Cap บวกข้อความให้ย่อเมื่อไฟล์ยาวเกิน
- **`chars`** คือจำนวนตัวอักษรของไฟล์ทั้งหมด ไม่ใช่ความยาวของ `text`
- **คำตอบเก่า (stale answer)** คือ `memory.got` ที่ `request` ไม่ตรงกับคำขอล่าสุดของ Agent นั้น

## Decisions

### 1. อ่านอย่างเดียว ไม่มีทางแก้จากแอปในรอบนี้

**Decision:** หน้า Memory แสดงผลอย่างเดียว ไม่มีช่องแก้ไขและไม่มีข้อความเขียนไฟล์

**Why:** ADR 0036 ให้ Agent เป็นคนเขียน Memory ผ่าน file tools และให้แอปเป็นที่อ่านเพื่อตรวจการวางยา การเปิดทางเขียนจาก Controller ต้องตัดสินเรื่องสิทธิ์, การบันทึกว่าใครแก้ และผลต่อ prompt cache ซึ่งเป็นงานคนละก้อน

**Rejected:** เพิ่ม `memory.set` ไปพร้อมกัน — ขยายขอบเขตเป็นสองทิศทางใน change เดียว และยังไม่มีข้อตกลงเรื่องการเขียนแทน Agent

### 2. หน้าเป็น route ลูกของ Agent ไม่ใช่หน้าใหม่ระดับบน

**Decision:** route `/agents/<id>/memory` และทางเข้าคือ `Row` ใน `Section` "Agent" ของ `AgentPage` ต่อจาก Character; เปิดเป็นการ push ปกติ (ไม่ลงทะเบียนเป็น `Stack.Screen` แบบ sheet เหมือน character) เพราะเป็นข้อความยาวที่ต้องเลื่อนอ่านเต็มจอ

**Why:** Memory เป็นของ Agent หนึ่งตัวและต้องอ่านคู่กับชื่อ/Character/Model; รูปแบบ route ลูกมีอยู่แล้ว (character, allowlist, model) จึงไม่ต้องมี navigation ใหม่หรือรายการ Agent ซ้ำ

**Rejected:** ใส่ Memory ไว้ในหน้า Task — Task หนึ่งใช้ Memory ที่ตรึงตอนเริ่ม Turn แต่ผู้ใช้ต้องการภาพรวมของ Agent ไม่ใช่ของ Task เดียว; และ ADR 0036 เรียกมันว่าหน้าของ Agent

### 3. ข้อความคู่ `memory.get` → `memory.got`

**Decision:** Controller ส่ง `memory.get` ที่มี `{ request, agent }`; Machine ตอบ `memory.got` ที่มี `{ request, agent, exists, chars, text }`

**Why:** ตามรูปแบบ request เป็นคำสั่ง (`list`, `get`) และคำตอบเป็นรูปอดีต (`listed`, `registered`, `linked`) โดยไม่เพิ่มคำศัพท์ใหม่; `request` echo กลับเพื่อทิ้งคำตอบเก่าแบบ `usage.list`; ขนาดคำตอบมีขอบเขตที่ Cap บวกข้อความสั้น ๆ จึงไม่ต้องแบ่งหน้า

**Rejected:** ใส่ Memory ไปกับ `agent.listed` — ทุกการต่อต้องแบกเนื้อหาและ Machine ต้องอ่านไฟล์ทุกครั้งแม้ไม่มีใครเปิดหน้านี้ (เหตุผลเดียวกับที่ ADR 0066 ไม่ใส่ usage ไปกับ `agent.listed`)

**Rejected:** ให้ Controller อ่านไฟล์ผ่าน `file.get` — `file.get` เป็นทางของ Attachment และไม่ผ่านเพดาน/ข้อความให้ย่อของ Memory ทำให้เห็นไม่ตรงกับ prompt

### 4. ตัวอ่านตัวเดียวใน runtime-core

**Decision:** เพิ่ม `runtime-core::memory::read_memory(workdir)` ที่คืน `{ exists, chars, text }` ในการอ่านครั้งเดียว; `memory_prompt()` เรียกตัวนี้และคืนเฉพาะ `text`; คำสั่ง `veeloe memory` กับตัวรับ `memory.get` ใช้ `read_memory`

**Why:** ปัจจุบัน `memory_prompt` อ่านไฟล์และตัดเพดานในที่เดียวอยู่แล้ว ถ้าเพิ่มตัวอ่านที่สองจะเกิดความเสี่ยงที่หน้าแอปกับ prompt เห็นไม่ตรงกัน (โดยเฉพาะข้อความให้ย่อ); การอ่านครั้งเดียวได้ทั้ง `chars` และ `text` โดยไม่ต้องอ่านซ้ำ

**Rejected:** อ่านไฟล์ใน `tasks.rs` เองแล้วตัดเพดานซ้ำ — เป็นตรรกะชุดที่สองที่เพี้ยนจาก prompt ได้

### 5. แสดงเป็นข้อความล้วน

**Decision:** หน้า Memory แสดง `text` ด้วย `Text` แบบข้อความล้วน ไม่ตีความเป็น Markdown, HTML หรือลิงก์

**Why:** Memory เป็นข้อความที่ Agent เขียนและอาจมีเนื้อหาจากที่อื่นปนมา (ADR 0036 ระบุความเสี่ยงวางยา) การตีความจึงเปิดทางให้เนื้อหาสั่งงานหน้าจอหรือฝังลิงก์ที่ผู้ใช้ไม่ได้ตั้งใจกด; หน้านี้มีไว้ให้ตรวจ ไม่ใช่ให้ใช้งานเนื้อหา

**Rejected:** ใช้ renderer Markdown ตัวเดียวกับข้อความใน Task — Memory ไม่ได้ถูกเขียนให้เป็นเอกสาร และความเสี่ยงไม่คุ้มกับความสวย

### 6. ไม่แคชลงฐานข้อมูล และทิ้งคำตอบเก่า

**Decision:** เก็บคำตอบล่าสุดไว้ในหน่วยความจำของ session ต่อ Agent; เปิดหน้าแล้วขอใหม่ (และมีปุ่มโหลดใหม่); `memory.got` ที่ `request` ไม่ตรงกับคำขอล่าสุดถูกทิ้ง; แสดงเวลาที่ได้ล่าสุด

**Why:** เนื้อหา Memory เปลี่ยนได้ทุกเมื่อที่ Agent เขียน และไม่มี event แจ้งการเปลี่ยน; การแคชลงฐานข้อมูลจะทำให้เห็นของเก่าโดยไม่รู้ตัว ส่วนเวลาและปุ่มโหลดใหม่ทำให้ผู้ใช้รู้ว่ากำลังดูของเมื่อไร

**Rejected:** cache ลง SQLite เหมือนรายการ Agent — ต้องมีกลไก invalidation ที่ยังไม่มี event รองรับ

### 7. Agent ในถังขยะอ่านได้

**Decision:** `memory.get` ของ Agent ที่มี `deletedAt` ยังตอบ `memory.got`; หน้าแอปยังไม่เพิ่มทางเข้าจากถังขยะในรอบนี้

**Why:** Task ของ Agent ที่ถูกลบยังเปิดอ่านได้ และ `veeloe memory` อ่านได้เช่นกัน; การปฏิเสธจะทำให้สองทางเห็นไม่ตรงกัน

## Risks

- ใน v0.1 มี Member เดียวคือ Owner จึงยังไม่มีตัวตรวจสิทธิ์ต่อ Agent; เมื่อมีหลาย Member (ADR 0059) ต้องบังคับ Manage ก่อนตอบ `memory.got`
- เนื้อหายาวถึง Cap ทำให้หน้าจอยาว; v0.1 ยอมให้เลื่อนอ่านทั้งก้อนก่อน แล้วค่อยพิจารณาแบ่งส่วนเมื่อมีคนใช้จริง
- ถ้า Agent เขียน Memory ถี่ ผู้ใช้ที่เปิดหน้าไว้อาจเห็นของไม่ตรงกับ Turn ถัดไปจริง ๆ; หน้าแสดงเวลาที่ได้ล่าสุดเพื่อบอกความสด
- ยังไม่มีปุ่มคัดลอกเนื้อหาในรอบนี้; ถ้าเพิ่มภายหลังต้องเตือนว่า Memory อาจมีการวางยา (ADR 0036) และการคัดลอกจะพามันออกนอกแอป
