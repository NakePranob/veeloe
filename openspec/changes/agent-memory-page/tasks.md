## 1. Protocol

- [x] 1.1 เพิ่ม `packages/protocol-ts/src/messages/memory.ts`: `MemoryGetBodySchema` (`request` 1–64, `agent`) และ `MemoryGotBodySchema` (`request` เดิม, `agent`, `exists`, `chars` จำนวนเต็มไม่ติดลบ, `text` ยาวไม่เกิน 4,200 ตัวอักษร ซึ่งพอสำหรับเพดาน 4,000 บวกข้อความให้ย่อ) พร้อม type และลงทะเบียน `memory.get`/`memory.got` ใน `messages/index.ts`
- [x] 1.2 เพิ่ม validator `memory.get`/`memory.got` ใน `packages/protocol/src/messages.rs` โดยบังคับ `text` ไม่เกิน 4,200 ตัวอักษรเท่ากับฝั่ง TypeScript และ fixture ใน `packages/protocol/vectors/messages.json` ให้ Rust กับ TypeScript อ่านตรงกัน
- [x] 1.3 ตรวจ `bun run check:protocol`

## 2. Runtime

- [x] 2.1 เพิ่ม `read_memory(workdir)` ใน `runtime-core/src/memory.rs` ที่คืน `exists`, `chars`, `text` จากการอ่านครั้งเดียว; ให้ `memory_prompt` เรียกตัวนี้และคงพฤติกรรมเดิม; เพิ่ม test ไฟล์หาย ไฟล์ว่าง ไฟล์พอดีเพดาน และไฟล์เกินเพดาน
- [x] 2.2 รับ `memory.get` ใน `runtime-supervisor/src/tasks.rs` แล้วตอบ `memory.got` จาก `read_memory`; Agent ที่ไม่รู้จักตอบด้วย `outbox.error(from, "agent.unknown")`; Agent ในถังขยะตอบปกติ
- [x] 2.3 ให้คำสั่ง `veeloe memory` ใน `runtime-supervisor/src/memory.rs` ใช้ `read_memory` แทนการอ่านซ้ำ และคงข้อความที่พิมพ์เหมือนเดิม
- [x] 2.4 เพิ่ม test ว่า `memory.get` ได้ `memory.got` ที่ `request` เดิมและ `text` เท่ากับ prompt, ยังไม่มีไฟล์ได้ `exists` เท็จ, Agent ในถังขยะตอบได้ และ id ที่ไม่รู้จักได้ `agent.unknown`
- [x] 2.5 ตรวจ `bun run check:runtime`

## 3. Controller

- [x] 3.1 เพิ่ม `requestMemory(machine, agent)`, สถานะต่อ Agent (loading, error, `exists`/`chars`/`text`, เวลาที่ได้) และตัวรับ `memory.got` ใน `features/machine-link/model/links.ts` โดยทิ้งคำตอบที่ `request` หรือ `agent` ไม่ตรงกับคำขอล่าสุด; เพิ่ม test ของการทิ้งคำตอบเก่าและการนับสถานะ
- [x] 3.2 เพิ่มหน้า `pages/agent-memory/` และ route `app/agents/[agent]/memory.tsx` (push ปกติ ไม่ต้องลงทะเบียน `Stack.Screen`): แสดง `text` แบบข้อความล้วน, จำนวนตัวอักษรเทียบ 4,000 พร้อมคอมเมนต์ว่าค่าต้องตรงกับ `MEMORY_LIMIT` ใน `runtime-core/src/memory.rs`, เวลาที่ได้ล่าสุด, ปุ่มโหลดใหม่, สถานะว่าง และ note เมื่อออฟไลน์ โดยใช้ `Screen`, `Section`, `Note`, `Empty`, `Text` เดิม
- [x] 3.3 เพิ่มแถว Memory ใน `Section` "Agent" ของ `pages/agents/ui/AgentPage.tsx` ชี้ไป `/agents/<id>/memory`
- [x] 3.4 เพิ่ม i18n th/en ของหน้า Memory และคำของแถวทางเข้า และตรวจว่าไม่มี key ขาด
- [x] 3.5 ตรวจ `bun run check:controller` และ `bun run test`

## 4. ตรวจและปิด change

- [ ] 4.1 QA บน emulator (ยังไม่ได้รัน: เครื่องนี้ไม่มี Simulator GUI/input และเว็บสร้าง key ไม่ได้): เปิดหน้ามีไฟล์เห็นเนื้อหาตรงกับไฟล์ ไฟล์เกินเพดานเห็นข้อความให้ย่อ ยังไม่มีไฟล์เห็นสถานะว่าง ออฟไลน์เห็น note และกดโหลดใหม่แล้วได้เนื้อหาใหม่
- [ ] 4.2 ตรวจว่าเนื้อหาที่มี `<script>` (รอ 4.1) หรือ Markdown แสดงเป็นข้อความ ไม่ถูกตีความ และไม่มีลิงก์ที่กดได้จาก Memory
- [x] 4.3 ตรวจ `bun run check` ผ่านทั้งชุด
- [ ] 4.4 ติ๊กบรรทัด `agent-memory-page` ใน `docs/roadmap.md` แล้ว archive change นี้พร้อม merge spec deltas เข้า `openspec/specs/`
