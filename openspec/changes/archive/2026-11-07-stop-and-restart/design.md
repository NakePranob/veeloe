# Design

## Context

ดู `proposal.md` ว่าทำไมต้องมี Stop ส่วนนี้บอกว่าของเดิมหน้าตาเป็นอย่างไรและตัดสินเรื่องเทคนิคอย่างไร

- worker ทำ Turn ใน `packages/runtime/src/worker/core/agent.ts` แบบ sequential: `runTurn` เรียก `llm.send` แล้วเรียก `tools.run` ตามที่ LLM ขอ ยังไม่มีทางยกเลิกกลางทาง — `Llm` (`ports.ts`) คืน Promise ของคำตอบ และ `ToolRunner.run` คืน Promise ของผล
- คำขอ LLM วิ่งผ่าน IPC ไป supervisor (`worker/adapters/anthropic-llm.ts` → `ipcFetch`) ซึ่งเป็น fetch ตัวจริงที่ supervisor ทำแทน ถ้ายกเลิกแค่ฝั่ง worker คำขอที่ supervisor ยังถืออยู่จะตอบกลับมาและถูกทิ้ง — ยอมรับได้ แต่ต้องกันไม่ให้เกิด `llm.message` หลังจาก Turn จบ
- คำสั่ง bash รันเป็น process group แยก (`bash.ts` ใช้ `detached: true` และ `process.kill(-pid)`) จึงมีทางฆ่าทั้งกลุ่มอยู่แล้ว
- log ของ Task อยู่ใน SQLite ของ Agent (`worker/adapters/sqlite-store.ts`) มี `events(task, after)` กับ `tasksStartedBy(member)` แต่ยังไม่มี query ว่า Task ไหนมี Turn ค้าง
- supervisor ส่งข้อความถึง worker ผ่าน `workers.send(agent, message)` (`ToWorker` ใน `ipc.ts`) ซึ่งมี `message`, `sync`, `list`, `agent`, `llm.response`, `approval` อยู่แล้ว
- Controller วาดหน้า Task จาก event ใน `items()` และสถานะจาก `statusOf()` ตามแบบ controller-prototype

## Goals / Non-Goals

**Goals:**
- Stop จบ Turn ได้จริงทุกจุดที่รออยู่: LLM, คำสั่ง bash, Approval
- ไม่มี event ของคำตอบที่มาหลังหยุดหลุดลง log
- Turn ที่ค้างถูกปิดอัตโนมัติทุกครั้งที่ worker เริ่ม ช่อง "กำลังทำงานตลอดกาล" หายไป
- Controller ทำตาม prototype: ปุ่มหยุดในช่องพิมพ์, ยืนยันก่อนหยุด, บรรทัดว่าใครหยุด, การ์ดขัดจังหวะ + ทำต่อ, สถานะ interrupted

**Non-Goals:**
- ไม่ย้อนไฟล์กลับ (ADR 0017)
- ไม่ปิด Turn ของ Task ย่อย (Delegation ยังไม่มีใน v0.1)
- ไม่ทำ self-update flow ของ ADR 0033 ส่วนที่เหลือ (พักรับงาน, สลับไฟล์, restart ทั้งเครื่อง) — งานนั้นเป็นของ ADR 0009
- ไม่ยกเลิกคำขอ LLM ที่ supervisor ถืออยู่ให้ถึง Provider (ตัดที่ฝั่ง worker พอ) — ดูข้อ 2 ด้านล่าง

## Decisions

### 1. Stop เป็น `AbortSignal` ที่ไหลผ่าน `Llm` และ `ToolRunner` ไม่ใช่ flag ที่เช็คเป็นจุด ๆ
`createAgentCore` ถือ `AbortController` ต่อ Turn ส่ง `signal` ลง `llm.send(request, signal)` และ `tools.run(name, input, signal)` เมื่อได้ Stop ก็ `abort()` แล้วรอ Promise ที่ค้างอยู่ reject/adopt ทางเลือกคือตั้ง flag แล้วเช็คก่อนเรียกทุกครั้ง — ไม่เอาเพราะคำสั่ง bash ที่ค้างหรือ stream ของ LLM จะไม่หยุดจนกว่าจะจบเอง ซึ่งคือปัญหาเดิม

### 2. คำขอ LLM ที่ค้างถูกทิ้งที่ฝั่ง worker
`ipcFetch` รับ `signal`; เมื่อ abort จะ reject Promise ของคำขอทันที คำตอบที่ supervisor ส่งกลับมาทีหลังถูกทิ้งเพราะไม่มี pending อยู่ ทางเลือกคือส่ง `llm.cancel` ไปให้ supervisor ตัด connection ถึง Provider — ไม่เอาใน change นี้เพราะต้องแก้ proxy กับตัวนับ token และผลที่ผู้ใช้เห็นไม่ต่างกัน (Turn จบแล้ว) แลกกับความซับซ้อนที่ยังไม่จำเป็น

### 3. `bashTool` รับ `signal` แล้วฆ่า process group ด้วยเหตุผล `stopped`
ตัวจับเวลาเดิมฆ่า group อยู่แล้ว ใช้ทางเดิมแต่ตั้งสาเหตุเป็น "stopped by the owner" เพื่อให้ LLM อ่านแล้วรู้ว่าไม่ใช่ error ของคำสั่ง ทางเลือกคือให้ Stop แค่ไม่รอผล — ไม่เอาเพราะโปรเซสจะค้างต่อหลัง Turn จบ

### 4. การรอ Approval ถูกปลดด้วย abort ไม่ใช่ตอบ deny
คำขอ Approval ที่ค้างอยู่ใน Turn จะถูก resolve เป็น "ไม่ได้รับอนุมัติเพราะ Turn ถูกหยุด" และไม่เขียน `approval.answered` (ADR 0033: นับว่าถูกปฏิเสธ) Controller คำนวณเป็นการ์ดสถานะ `closed` อยู่แล้วจาก `turn.ended` ใน `items()` คำตอบที่มาทีหลังได้ `approval.unknown` ตามที่มีอยู่แล้ว

### 5. worker ปิด Turn ที่ค้างตอนเริ่ม ด้วย query ใหม่ใน store
เพิ่ม `openTurns(): string[]` ใน `EventStore` (SQL: Task ที่ event ล่าสุดที่เป็น `turn.started`/`turn.ended` คือ `turn.started`) เรียกครั้งเดียวตอน `runWorker` สร้าง core แล้วเขียน `turn.interrupted` + `turn.ended {reason:"interrupted"}` ให้ทุก Task ทางเลือกคือ scan ทุก Task ใน memory — ไม่เอาเพราะ Task สะสมได้มากและ worker เริ่มบ่อย

### 6. สถานะ `interrupted` มาจาก `turn.ended` ที่มีเหตุผล `interrupted`
`statusOf` เพิ่มค่าที่อ่านจาก `latest_kind === "turn.interrupted"` หรือ `turn.ended` ที่ `reason === "interrupted"` ไม่เพิ่ม field ใหม่ในฐานข้อมูล ทางเลือกคือเก็บคอลัมน์สถานะ — ไม่เอาเพราะซ้ำกับ log และผิด ADR 0018 (log เป็นความจริงเดียว)

### 7. `task.stop` มี `id` เพื่อให้ส่งซ้ำได้
เหมือน `task.message` แต่ไม่เขียนอะไรลง log ตอนรับ (เขียนตอนหยุดจริง) worker จำ `id` ล่าสุดที่หยุดไปในหน่วยความจำ ถ้าซ้ำก็ไม่ทำอะไร ทางเลือกคือไม่มี id — ไม่เอาเพราะ Controller ส่งซ้ำได้เมื่อต่อใหม่

## Risks / Trade-offs

- [Risk] Stop ระหว่างที่คำสั่งกำลังเขียนไฟล์ ทำให้ไฟล์ครึ่ง ๆ กลาง ๆ → Mitigation: เป็นเรื่องที่ ADR 0017 ยอมรับไว้แล้ว (Stop ไม่ย้อนกลับ) และกล่องยืนยันบอกไว้
- [Risk] คำขอ LLM ที่ถูกทิ้งยังกิน token ที่ Provider → Mitigation: ยอมรับใน v0.1 (ADR 0043 นับ token ที่ Provider รายงาน ซึ่งมาถึงแล้วหรือไม่มาก็ไม่ทำให้ยอดเพี้ยน)
- [Risk] worker ปิด Turn ตอนเริ่ม อาจปิด Turn ที่จริง ๆ ยังทำงานอยู่ถ้ามี worker สองตัวของ Agent เดียว → Mitigation: supervisor เปิด worker หนึ่งตัวต่อ Agent (ADR 0020) และ sandbox กันไม่ให้ตัวที่สองแย่ง tasks.db
- [Trade-off] ปุ่มหยุดเห็นเฉพาะตอนช่องพิมพ์ว่าง ตาม prototype ทำให้คนที่พิมพ์ค้างไว้ต้องลบข้อความก่อนหยุด — แลกกับการที่ปุ่มเดียวไม่ต้องเดาว่าผู้ใช้หมายถึงอะไร

## Migration Plan

- Machine เก่าไม่มีอะไรต้องย้าย: event kind ใหม่เป็นแค่การเพิ่ม และ `turn.ended` ที่มี `reason` เดิมยังอ่านได้
- Controller เก่าข้าม event ที่ไม่รู้จักอยู่แล้ว (ADR 0023) จึงไม่พังเมื่อ Machine ใหม่เขียน `turn.stopped`
- Turn ที่ค้างจากก่อนอัปเดตจะถูกปิดด้วยกฎใหม่ตอน worker เริ่มครั้งแรกหลังอัปเดต

## Open Questions

- ไม่มี
