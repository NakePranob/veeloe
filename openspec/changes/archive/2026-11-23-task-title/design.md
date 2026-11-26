## Context

- log ของ Task เก็บอยู่ที่ supervisor และ worker append ผ่าน IPC (`State::append`) Controller ได้ทุก event ของ Task ที่ Member เริ่มผ่าน `task.events` แล้วเก็บไว้ใน `task_event` บนเครื่อง
- harness มีแบบอย่างของการเรียก LLM ที่ไม่ใช่ส่วนของบทสนทนาอยู่แล้วสองที่ คือ `compact_if_needed` และ `flush_memory` ใน `runtime-core/src/agent.rs` ทั้งสองไม่มี tool ใช้ `state.llm.send` ตัวเดียวกับ Turn และถ้าล้มเหลวก็แค่ไม่ได้ผล
- Controller คิดสถานะและ Mood จาก event ล่าสุดที่อยู่ในชุด `KNOWN` (ค่าของ `TaskEventKind`) ส่วน event ภายในอย่าง `context.usage`, `context.compacted` และ `memory.saved` ไม่อยู่ในชุดนี้ จึงไม่ทำให้สถานะเปลี่ยน
- แถว Task ในหน้า Agent ใช้ `previewOf(task)` ซึ่งเป็นข้อความล่าสุด (`AgentPage.tsx`)

## Goals / Non-Goals

**Goals:**
- ทุก Task ที่คุยจบอย่างน้อยหนึ่ง Turn มีชื่อที่บอกว่าเป็นเรื่องอะไร และชื่อนั้นไม่เปลี่ยนตาม Turn
- ไม่มีซอง คำสั่ง หรือตารางใหม่ใน Protocol, Hub หรือ supervisor

**Non-Goals:**
- ค้น Task ด้วยชื่อ

## Decisions

**1. ชื่อเป็น event ใน log ไม่ใช่ column หรือไฟล์แยก**
log เป็น append-only (ADR 0018) และเป็นทางเดียวที่เนื้อหาของ Task ไปถึง Controller แบบเข้ารหัส (ADR 0005, 0063) ถ้าเก็บใน column ของตาราง `task` ต้องเพิ่มการ sync ใหม่ และต้องมีทางแก้ค่าที่ขัดกับ append-only ส่วน event ใช้ทางเดิมได้ทั้งหมด ทั้งการตามทันหลังหลุด เครื่องที่ Link มาทีหลัง และ backup

**2. ตั้งชื่อหลัง Turn จบ ไม่ใช่ตอนได้ข้อความแรก**
ถ้าทำตอนได้ข้อความแรก จะมีสองคำขอวิ่งพร้อมกันตอนเริ่ม Task และได้แค่คำถามมาตั้งชื่อ ส่วนการทำหลัง Turn จบได้คำตอบของ Agent มาช่วยด้วย และไม่ชนกับ Turn ทางเลือกที่ตัดทิ้งไป: ให้ Agent ตั้งชื่อผ่าน tool `set_title` ในระหว่าง Turn ซึ่งเพิ่ม tool ที่ LLM อาจลืมเรียก หรืออาจเรียกซ้ำ

**3. รันเป็น task แยก ไม่บล็อกคิว**
ใน `start_turn` หลัง `run_turn` คืนค่า ถ้า `turn.ended` ที่เพิ่ง append เป็น `done` ตัวแรกของ Task ให้ `tokio::spawn` งานตั้งชื่อ แล้วค่อย `drain_queued` ตามเดิม งานนี้ไม่ถือ `running` จึงไม่ทำให้ Agent ไม่ว่าง และ Turn ถัดไปเริ่มได้ทันที `task.titled` อาจไปลงหลัง event ของ Turn ถัดไป ซึ่งไม่เป็นไร เพราะ Controller อ่านชื่อจาก event ล่าสุดของ kind นี้ ไม่ได้ดูตำแหน่ง

**4. "ครั้งเดียว" มาจาก log ไม่ใช่ state ใหม่**
เงื่อนไขคือ "`turn.ended` ที่เป็น `done` ใน log มีตัวเดียว คือตัวที่เพิ่งเขียน" ถ้าล้มเหลว ตอน Turn ถัดไปจบจะมี `done` สองตัวแล้ว จึงไม่ลองใหม่ (ตาม spec) และไม่ต้องจำว่าเคยลองไปแล้ว ถ้า worker ตายระหว่างรอก็ได้ผลเดียวกัน

**5. คำขอ**
- system: ตั้งชื่อหัวข้อของบทสนทนา บรรทัดเดียว ไม่เกิน 60 ตัวอักษร ภาษาเดียวกับผู้ใช้ ไม่มีเครื่องหมายคำพูด ให้ตอบแค่ชื่อ
- messages: ข้อความแรกของ Member กับข้อความ text สุดท้ายของ Agent ใน Turn นั้น ตัดเหลืออย่างละ 2,000 ตัวอักษร
- ผลที่ได้ตัดเหลือบรรทัดแรก ตัดช่องว่างกับเครื่องหมายคำพูดหัวท้าย แล้วตัดเหลือ 60 ตัวอักษรด้วยโค้ด เหมือนที่ `FLUSH_MAX_CHARS` ไม่เชื่อความยาวที่ LLM ตอบ ถ้าว่างก็ไม่ append
- ใช้ `state.llm.send` ด้วย `task` ของ Task นั้น token จึงนับเข้า Budget และประวัติการใช้ของ Task ตามทางเดิม (ADR 0043, 0066) ถ้า Budget หมด supervisor จะปฏิเสธคำขอ แล้วผลก็คือไม่มีชื่อ

**6. Protocol: ชื่อ kind อยู่นอก `TaskEventKind`**
เพิ่ม `TaskTitled = "task.titled"` เป็นค่าคงที่แยก ไม่ใส่ใน `TaskEventKind` เพราะชุดนั้นคือ `KNOWN` ที่ใช้คิดสถานะกับ Mood ถ้าใส่ไว้ `task.titled` ที่มาหลัง `turn.ended` จะทำให้ `statusOf` คิดว่ายัง working อยู่ ซึ่งเข้ากับ ADR 0023 เพราะ Controller รุ่นเก่าจะข้าม kind นี้ไปเอง

**7. Controller**
- `LIST_TASK_SUMMARIES` เพิ่ม subquery สองตัว: `title_body` คือ body ของ `task.titled` ล่าสุด และ `first_body` คือ body ของ `member.message` ที่มี seq ต่ำที่สุด
- `titleOf(summary)` คืน title ถ้ามี ไม่มีก็คืนบรรทัดแรกของข้อความแรก ไม่มีอีกก็คืน `""` แล้ว `AgentPage` ใช้ `titleOf(task) || t("tasks.untitled")` แทน `previewOf`
- `items.ts` ของหน้า Task ไม่รู้จัก kind นี้อยู่แล้ว ต้องตรวจให้แน่ว่าไม่โผล่เป็นบรรทัด
- Inbox ไม่เปลี่ยน

**9. Member แก้ชื่อ**
คำสั่งใหม่ `task.rename { agent, title }` ที่มี id ของ Task ในหัวซอง เดินทางแบบ `task.stop`: supervisor ส่ง `ToWorker::Retitle` ให้ worker ซึ่งตรวจว่าผู้ส่งเป็นคนเริ่ม Task เหมือน Stop แล้ว append `task.titled { title, member }` เป็นการเพิ่มชนิดซองตาม ADR 0023 Runtime รุ่นเก่าตอบ `task.unknown` ไม่มี id กันส่งซ้ำ เพราะส่งซ้ำก็ได้ชื่อเดิม การตั้งชื่ออัตโนมัติข้ามเมื่อ log มี `task.titled` แล้ว และตรวจอีกครั้งก่อน append เผื่อ Member แก้ชื่อระหว่างรอ LLM การแก้ชื่ออยู่ที่ชื่อบนแผ่นรายละเอียด (ข้อ 10)

**10. แผ่นรายละเอียด Task และ context แยกส่วน**
ตาม board "Task: รายละเอียด" บน canvas การกดค้างแถวและการแตะหัวหน้า Task เปิด `tasks/[task]/details` เป็น formSheet ไม่มีแถบหัว มีแค่ grabber ชื่อเป็น `EditableTitle` ใน shared/ui (ข้อความที่แตะแล้วเป็นช่องในที่) ปุ่มหยุดใช้ `useComposer().stop` เพื่อได้การถามยืนยันเดียวกับช่องพิมพ์ หน้าอยู่ใน slice `pages/task` ไม่ใช่ slice ใหม่ เพราะไฟล์ที่แก้และไฟล์ที่ส่งมาอ่านจาก `items()` ของหน้า Task และ page นำเข้า page ไม่ได้ (`fsd-layer-direction`) Runtime เพิ่ม `parts` ใน `context.usage` แต่คง `tokens` ไว้ เพราะการย่อ context วัดแค่ข้อความ และวงข้างช่องพิมพ์อ่าน `tokens` ยอดของ `parts` จึงสูงกว่า `tokens` ได้ เส้นที่ 70% ในแถบจึงเป็นตำแหน่งโดยประมาณของจุดย่อ สีของส่วนที่มาทุก Turn เป็นเทา ส่วนของบทสนทนาใช้สีของ Agent ทั้งยกขึ้นและกดลง (`tint`, `shade`) ให้ความสว่างต่างกันแม้ Agent สีอ่อน ทางที่ตัดทิ้ง: เมนูกดค้างของ `Link.Menu` ที่มีข้อเดียว และหน้าแก้ชื่อแยก

**8. หัวหน้า Task**
Owner ตัดสินหลังเห็นชื่อในแอปจริง ให้ Character ย้ายไปติดปุ่มกลับทางซ้าย และบรรทัดใต้ชื่อ Agent เปลี่ยนจากสถานะเป็นชื่อ Task (`titleOfEvents` อ่านจาก event ที่หน้ามีครบอยู่แล้ว) สถานะยังเห็นได้จาก Mood ของ Character และการ์ดใน log บน iOS ใช้ `unstable_headerLeftItems` แบบ `custom` กับ `hidesSharedBackground` เพราะ iOS 26 จะห่อ item ด้านซ้ายด้วยแคปซูลแก้ว และต้องตั้ง `headerBackVisible` เองเพราะ `headerLeft` ซ่อนปุ่มกลับ ส่วนจอแบ่งสองฝั่งไม่มีปุ่มกลับ ทางที่ตัดทิ้ง: คง `headerTitle` ไว้ตรงกลาง เพราะ iOS วาง title ตรงกลางเสมอและเลือกชิดซ้ายไม่ได้ board บน canvas ยังเป็นแบบเดิม ต้องแก้ตาม

## Risks / Trade-offs

- [ชื่อที่ LLM ตั้งอาจไม่ตรงเรื่อง หรือ LLM อาจถูกข้อความชักจูงให้ตั้งชื่อแปลก ๆ] → ชื่อเป็นแค่ข้อความที่แสดงบนจอ ไม่มีผลกับสิทธิ์หรือคำสั่ง Controller วาดเป็น text ธรรมดา และตัดความยาวด้วยโค้ด
- [เสีย token เพิ่ม Task ละหนึ่งคำขอ] → input ไม่เกินประมาณ 4,000 ตัวอักษร output ไม่กี่สิบ token และใช้ model ของ Task เพราะ v0.1 ยังไม่มีการตั้ง model ราคาถูก
- [Task ที่ Turn แรกล้มเหลวแล้วไม่มี `done` เลย จะไม่มีชื่อ] → แสดงข้อความแรกแทน ซึ่งก็พอแยก Task ได้แล้ว
- [Task ที่มีอยู่ก่อนการเปลี่ยนนี้ไม่มีชื่อ] → ใช้ข้อความแรกแทน ไม่ย้อนตั้งชื่อให้
