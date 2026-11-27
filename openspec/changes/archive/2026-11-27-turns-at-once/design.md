## Context

ดู proposal.md สำหรับเหตุผล สภาพของโค้ดตอนนี้:

- worker หนึ่งตัวต่อ Agent (ADR 0020) และ `runtime-core/src/agent.rs` ถือ Turn ได้ตัวเดียว: `running: Option<RunningTurn>`, คิว `queued` ของทั้ง Agent, `drain_queued` หยิบข้อความถัดไปหลัง Turn จบ การนับ Turn ค้าง (`activity`, `stalled`, `waiting_for_person`) อยู่ระดับ Agent
- การตรวจคำสั่งอยู่ใน worker: `run_tool` เทียบ Allowlist ด้วย `matches_allowlist` แล้วขอ Approval `matches_allowlist(command, &[])` คือ "คำสั่งในตัว" ของ ADR 0075 พอดี
- tool `memory` เขียน `MEMORY.md` และบันทึกรายวันเอง (`runtime-worker/src/tools/memory.rs`)
- LLM ผ่าน `IpcTransport` ที่มีรหัสต่อคำขอ ส่งหลายคำขอพร้อมกันได้อยู่แล้ว
- supervisor: `approval.rs` เก็บ Turn ต่อ Agent ตัวเดียว (`Turns`, `current_turn`) และใช้ใน proxy (`ask`, การปฏิเสธเมื่อไม่มี Turn), Idle Work (`main.rs`: `quiet_since`, การเช็กว่าไม่ว่าง), Schedule (`busy` ใน `triggers.rs`) และ `trigger.run`
- คำสั่งได้ `HTTP_PROXY` ชุดเดียวทั้ง worker ตอนสร้าง worker proxy ของ supervisor จึงรู้แค่ Agent ไม่รู้ Turn
- tool ทุกตัวรับแค่ `(name, input, cancel)` ไม่รู้ว่าถูกเรียกจาก Turn ไหน

## Goals / Non-Goals

**Goals:**
- Turn ของคนละ Task ทำพร้อมกันใน worker เดียว ส่วน Task เดียวกันยังทีละ Turn
- ล็อก Workdir ที่ขอตอนจะเขียน มีลำดับคนก่อนงานพื้นหลัง และคืนเสมอเมื่อ Turn จบ
- ทุกที่ที่เคยถาม "Turn ปัจจุบันของ Agent" ถามเป็นราย Turn ได้

**Non-Goals:**
- ล็อกของ Project, worktree, Library และการยืมล็อกของ Delegation (ยังไม่มีในโค้ด)
- worker หลายตัวต่อ Agent: ทุก Turn ของ Agent ใช้สิทธิ์ชุดเดียวกันอยู่
- เปลี่ยน Protocol ระหว่าง Controller กับ Machine
- เพดานจำนวน Turn พร้อมกัน: เพดาน Budget และ CPU/หน่วยความจำของ worker คุมอยู่แล้ว

## Decisions

**1. ล็อกอยู่ใน worker ไม่ใช่ supervisor** ADR 0080 เขียนว่า supervisor ถือล็อก เพราะ worktree ของ Project ใช้ร่วมหลาย Agent แต่ที่เขียนที่มีวันนี้ (Workdir, `MEMORY.md`) เป็นของ Agent เดียวและมี worker ตัวเดียว ล็อกใน `runtime-core` จึงไม่ต้องมีรอบ IPC ต่อการเขียน และคืนเองเมื่อ worker ปิด ทางเลือกที่ไม่เลือก: ล็อกใน supervisor ผ่าน IPC ช้ากว่าและต้องจัดการกรณี worker ตายเองโดยไม่ได้อะไรเพิ่มตอนนี้ เมื่อมี Project ค่อยย้ายล็อกของ worktree ไป supervisor ตาม ADR 0080 โดยใช้ trait เดียวกัน

**2. ล็อกเขียนเองแบบมีสองแถว** `WriteLock` ใน runtime-core: ผู้ถือหนึ่งราย (Task) กับแถวรอสองแถว คนและงานพื้นหลัง แต่ละแถว FIFO เมื่อคืน ล็อกไปที่หัวแถวคนก่อน ถ้าแถวคนว่างจึงไปแถวงานพื้นหลัง การรอยกเลิกได้ด้วย `Cancel` ของ Turn (Stop และเพดานเวลา) Turn ที่ถืออยู่แล้วขอซ้ำได้ทันที ทางเลือกที่ไม่เลือก: `tokio::sync::Mutex` ไม่มีลำดับความสำคัญ และ `RwLock` ไม่ตรงกับ "อ่านไม่ต้องขอเลย"

**3. จุดที่ขอล็อก** ใน `run_tool` หลังผ่าน Allowlist หรือ Approval แล้ว ก่อน `call_tool`: `write`, `edit` และ `bash` ที่ `matches_allowlist(command, &[])` เป็นเท็จ tool `memory` ใช้ `MemoryLock` (`tokio::sync::Mutex` ธรรมดาที่ถือเฉพาะระหว่างการเรียก) tool อื่นรวมถึง plugin ไม่ขอ การคืนล็อกผูกกับจุดจบของ Turn ทุกทาง (`end` ของ Turn) ไม่ใช่กับ tool

**4. Turn หลายตัวใน agent.rs** `running` เป็น `HashMap<task, RunningTurn>` และคิวเป็นต่อ Task (`HashMap<task, VecDeque<ToWorker>>`) ข้อความเข้า Task ที่มี Turn อยู่ต่อคิวของ Task นั้น ข้อความเข้า Task อื่นเริ่ม Turn ทันที Turn ที่จบหยิบข้อความถัดไปของ Task ตัวเองเท่านั้น `activity`, `stalled` และ `waiting_for_person` ย้ายเข้า `RunningTurn` และ `watch_stall` ดูราย Turn ช่วงรอล็อกนับเหมือนรอ Approval (เพิ่ม `waiting_for_person` ระหว่างรอ) Stop หา Turn จาก Task เหมือนเดิม การตั้งชื่อ Task (`titling`) เป็นต่อ Task

**5. Turn รู้ว่าตัวเองเป็นของคนหรืองานพื้นหลัง** ข้อความ `ToWorker::Run` (มี `trigger`) เป็นงานพื้นหลัง `ToWorker::Message` เป็นของคน ตรงกับที่ supervisor แยกจาก `trigger` ใน `turn.started`

**6. บอก proxy ว่าคำขอมาจาก Turn ไหน** ตอนเริ่ม Turn worker สุ่ม token ของ Turn และส่ง frame ภายใน `FromWorker::TurnProxy { task, token }` ให้ supervisor ก่อน tool แรก supervisor เก็บ token ไว้ใน Turn ของ Task นั้นและลบเมื่อ Turn จบ token ไม่ลง Task log tool รู้ Turn ของตัวเองจาก `tokio::task_local!` ที่ `run_tool` ตั้งไว้ (อยู่ใน `plugin-api` เพื่อให้ worker อ่านได้) `bash` ใส่ `HTTP_PROXY=http://<token>@127.0.0.1:<port>` ต่อคำสั่ง และ `web_fetch` ใส่ credential เดียวกัน proxy อ่าน `Proxy-Authorization` แล้วหา Turn คำขอที่ไม่มี token หรือ token ไม่ตรง Turn ที่ยังไม่จบถูกปฏิเสธ git broker ใช้ Turn เดียวกันนี้ ทางเลือกที่ไม่เลือก: proxy listener ต่อ Turn (ต้องเปิด port ใหม่ใน sandbox ทุก Turn), ใช้รหัส Task เป็นตัวบอก (เดาได้ Turn หนึ่งอ้างเป็นอีก Turn ได้ง่าย)

**7. supervisor นับ Turn ราย Task** `Turns` เป็น `HashMap<agent, HashMap<task, Turn>>` และ `Turn` มี `trigger` (id) กับ `token` เพิ่ม คำถามเดิมแทนด้วย:
- `turn(agent, task)` และ `turn_by_token(agent, token)` สำหรับ Approval และ proxy
- `person_running(agent)`: มี Turn ที่ไม่มี `trigger` ไหม สำหรับ Idle Work
- `round_running(agent, trigger)`: รอบของ Trigger นี้ยังไม่จบไหม สำหรับ Schedule และ `trigger.run`
`quiet_since` ของ Idle Work ขยับเฉพาะเมื่อ Turn ที่ไม่มี `trigger` เริ่มหรือจบ Approval ของคำสั่ง (ที่ worker ขอผ่าน `approval.requested`) ผูกกับ Task อยู่แล้ว ส่วน Approval ของโดเมนผูกกับ Turn จาก token

**7.1 คำขอ LLM ของ worker ไม่ต่อแถวกันใน supervisor** เดิม supervisor รอคำตอบของ Provider อยู่ในลูปที่อ่านข้อความจาก worker คำขอของ Turn หนึ่งจึงขวางข้อความทุกอย่างของ Turn อื่น แม้ worker จะทำหลาย Turn พร้อมกันแล้ว (e2e เจอตอนเขียน test) ตอนนี้แต่ละคำขอทำใน task ของตัวเอง แล้วส่งคำตอบกลับเข้าลูปผ่านช่องแยก

**8. เพดาน 15 นาทีของ Schedule** ย้าย `PIECE_LIMIT_S` ออกจาก `idle.rs` เป็นค่าของงานพื้นหลังใน `triggers.rs` และ `start_round` ส่ง `limit_s` เดียวกันให้ทุกรอบ ทั้งที่ถึงเวลาเองและ `trigger.run`

**9. Controller** Inbox ต้องรู้ว่า Agent มี Task ไหนที่ Turn ยังไม่จบ ไม่ใช่แค่ Task ล่าสุด เพิ่ม query ที่คืน Task ที่ยังทำงานที่ใหม่สุดต่อ Agent จากแถว `task` ที่เก็บสรุปไว้แล้ว แล้ว Inbox ใช้แถวนั้นแทน Task ล่าสุดเมื่อมี คำของ `lastSkip` ที่ `why: "busy"` ใน sheet ของ Schedule เปลี่ยนเป็น "ข้ามเพราะรอบก่อนยังไม่จบ" ทั้งสองภาษา

## Risks / Trade-offs

- [Turn ที่อ่านเห็นไฟล์ที่อีก Turn แก้ค้างครึ่งทาง] → ยอมรับตาม ADR 0080 เหมือน Ask การเขียนของ tool `write` เป็น atomic อยู่แล้วจึงไม่เห็นไฟล์ครึ่งไฟล์
- [`npm test` และคำสั่งพัฒนาส่วนใหญ่ถือล็อก งานแก้โค้ดยังผลัดกัน] → ตั้งใจ สิ่งที่ได้คือคุย อ่าน และ tool อื่นไม่รอ
- [Turn ใน worker เดียวกันใช้ localhost เดียวกัน dev server สองตัวแย่งพอร์ต] → Agent เห็น error ของพอร์ตเองและเลือกพอร์ตใหม่ได้ ไม่แก้ในรอบนี้
- [หลาย Turn พร้อมกันใช้ Budget เร็วขึ้นและชน rate limit ของ Provider] → เพดาน Budget ต่อวันยังเดิม error ของ Provider จบ Turn นั้นตามปกติ
- [token ของ Turn อยู่ใน env ของคำสั่ง โปรเซสอื่นของ Agent เดียวกันอ่านได้] → token บอกตัว ไม่ได้ให้สิทธิ์เพิ่ม Turn ของ Agent เดียวกันอยู่ใน sandbox เดียวกันอยู่แล้ว ที่เสียได้มากสุดคือรอบที่ไม่มีคนเฝ้าอ้างเป็น Turn ของคนเพื่อให้ถาม Approval แทนการปฏิเสธ ซึ่งยังต้องให้คนกดอนุญาต
- [refactor `agent.rs` กระทบทุก test ของ runtime-core และ supervisor] → แยก task: ทำ Turn หลายตัวพร้อมคิวต่อ Task ให้ test เดิมผ่านก่อน แล้วค่อยเพิ่มล็อก
- [Controller รุ่นก่อนไม่รู้ว่า Task เก่ายังทำอยู่] → แค่แสดงสถานะตาม Task ล่าสุดเหมือนเดิม ไม่มีอะไรพัง

## Migration Plan

ไม่มีข้อมูลที่ต้องย้าย Runtime รุ่นใหม่เริ่มทำ Turn พร้อมกันทันทีที่อัปเดต และ Controller รุ่นก่อนยังใช้ได้ เพราะ Protocol ไม่เปลี่ยน ย้อนกลับได้ด้วยการลง Runtime รุ่นก่อน

## Open Questions

- จะแสดงงานพื้นหลังที่กำลังทำเป็นจุดเล็กบน Character ตาม ADR 0080 ในรอบนี้หรือรอบถัดไป ไม่กระทบ spec เพราะ Mood ยังมาจาก Task เดิม
