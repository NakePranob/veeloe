## 1. Turn หลายตัวใน worker (runtime-core)

- [x] 1.1 `agent.rs`: `running` เป็นต่อ Task และคิวเป็นต่อ Task ข้อความเข้า Task อื่นเริ่ม Turn ทันที Turn ที่จบหยิบเฉพาะคิวของ Task ตัวเอง Stop, sync และ `titling` ทำงานราย Task; test เดิมใน `runtime-core/tests` ผ่านทั้งหมด และมี test ใหม่ว่าสอง Task ได้ `turn.started` ก่อน Turn แรกจบ ส่วนข้อความที่สองของ Task เดียวกันรอ
- [x] 1.2 การนับ Turn ค้างราย Turn: `activity`, `stalled`, `waiting_for_person` ย้ายเข้า Turn และ `watch_stall` ดูราย Turn; test ว่า Turn หนึ่งเงียบแล้วได้ `turn.stalled` โดยอีก Turn ที่ทำงานอยู่ไม่ทำให้นับใหม่
- [x] 1.3 `WriteLock` สองแถว (คน, งานพื้นหลัง) ที่ยกเลิกการรอด้วย `Cancel` ได้ และคืนเมื่อผู้ถือจบ; unit test ของลำดับ (คนแซงงานพื้นหลัง, FIFO ในแถว, ขอซ้ำได้ทันที, ยกเลิกแล้วไม่ได้ล็อก)
- [x] 1.4 `run_tool` ขอล็อกหลังผ่าน Allowlist หรือ Approval ก่อน `write`, `edit` และ `bash` ที่ไม่ใช่คำสั่งในตัว (`matches_allowlist(command, &[])`) และคืนตอน Turn จบทุกทาง ช่วงรอนับเป็น `waiting_for_person`; test ใน `runtime-core/tests/agent.rs`: Turn B `read` ได้ระหว่าง A ถือ, `write` ของ B รอจน A จบ, `ls` ไม่รอ, Stop ของ B ที่รอจบด้วย `stopped`, A ล้มเหลวแล้ว B ได้ล็อก, ไม่มี `turn.stalled` ระหว่างรอ
- [x] 1.5 tool `memory` เขียนผ่าน `MemoryLock` ที่ถือเฉพาะระหว่างการเรียก; test ว่าสอง Turn ต่อท้ายพร้อมกันได้ครบสองบรรทัด และจด Memory ได้ระหว่างที่อีก Turn ถือล็อก Workdir

## 2. Turn บอก proxy ว่าเป็นใคร

- [x] 2.1 `plugin-api`: `task_local` ของ Turn ปัจจุบัน (Task, token) ที่ `run_tool` ตั้งก่อนเรียก tool; worker สุ่ม token ต่อ Turn และส่ง `FromWorker::TurnProxy { task, token }` ก่อน tool แรก; test ใน `runtime-core/tests/ipc.rs`
- [x] 2.2 `runtime-worker`: `bash` ตั้ง `HTTP_PROXY`/`HTTPS_PROXY` ที่มี token ของ Turn ต่อคำสั่ง และ `web_fetch` ใส่ credential เดียวกัน; test ใน `runtime-worker/tests` ว่า env ของคำสั่งมี token ของ Turn ที่เรียก

## 3. supervisor

- [x] 3.1 `approval.rs`: `Turns` เก็บราย Task พร้อม `trigger` และ `token`; เพิ่ม `turn`, `turn_by_token`, `person_running`, `round_running` แทน `current_turn`; รับ `TurnProxy`; unit test ใน `approval.rs`
- [x] 3.2 `proxy.rs`: อ่าน `Proxy-Authorization` หา Turn, ปฏิเสธคำขอที่ไม่มี token หรือ Turn จบแล้ว, Approval ของโดเมนและ `approval.skipped` ไปที่ Task ของ Turn นั้น, git broker ใช้ Turn เดียวกัน; test ใน `tests/egress.rs` หรือ test ของ proxy: สอง Turn ขอโดเมนพร้อมกันได้คำขอแยก Task และรอบที่ไม่มีคนเฝ้าถูกปฏิเสธแม้มี Turn ของคนทำอยู่
- [x] 3.3 Schedule: `busy` คือ `round_running` ของ Trigger นั้น ทั้งใน `tick` และ `trigger.run`; test ใน `tests/triggers.rs` ว่ารอบเริ่มระหว่าง Turn ของ Task อื่น และถูกข้ามด้วย `why: "busy"` เมื่อรอบก่อนของตัวเองยังทำอยู่
- [x] 3.4 เพดาน 15 นาทีของทุกรอบงานพื้นหลัง: ย้ายค่าไป `triggers.rs` และ `start_round` ส่ง `limit_s`; test ว่า `TriggerRun` ของ Schedule มี `limit_s` 900
- [x] 3.5 Idle Work: ตื่นเมื่อ `person_running` เป็นเท็จ และ `quiet_since` ขยับเฉพาะ Turn ที่ไม่มี `trigger`; test ใน `tests/triggers.rs` หรือ unit test ว่ารอบของ Schedule ที่ทำอยู่ไม่ทำให้ Idle Work ไม่ตื่น
- [x] 3.6 `workers.rs`: คำขอ LLM ของ worker ทำใน task ของตัวเองและส่งคำตอบกลับผ่านช่องแยก ไม่รอในลูปที่อ่าน worker; ตรวจด้วย e2e ใน 5.2

## 4. Controller

- [x] 4.1 query Task ที่ Turn ยังไม่จบที่ใหม่สุดต่อ Agent และ Inbox ใช้แถวนั้นแทน Task ล่าสุดเมื่อมี (สถานะ แท็บ Mood และข้อความ); unit test ของ query ใน `entities/task`
- [x] 4.2 คำของ `lastSkip` `busy` ใน sheet ของ Schedule เป็น "ข้ามเพราะรอบก่อนยังไม่จบ" ทั้งไทยและอังกฤษ; `bun run check:controller` ผ่าน
- [x] 4.3 ลองบน iOS Simulator: เปิดสอง Task ส่งข้อความทั้งสองก่อนอันแรกตอบ ได้คำตอบทั้งสองโดยไม่รอกัน และ Inbox บอกว่ากำลังทำงานจนทั้งสองจบ ทั้งสว่างและมืด

## 5. คำ เอกสาร และการตรวจ

- [x] 5.1 `CONTEXT.md`: แก้คำของ Agent, Turn, Idle Work, Stop และ Memory ตาม ADR 0080
- [x] 5.2 e2e ใน `e2e/agent-task.test.ts`: ส่งสองข้อความเข้าสอง Task ผ่าน relay จริงแล้วได้ `turn.started` ของทั้งสองก่อน `turn.ended` แรก; `bun run test:e2e` ผ่าน
- [x] 5.3 `bun run check` และ `bun run test` ผ่าน แล้ว archive change และปิด #65 ใน commit
