## 1. Character

- [x] 1.1 เพิ่ม `react-native-svg` 15.16.0 ใน `controller/` และ `entities/character/model/look.ts` ที่มีตารางตัวเลือก, `lookOf` และ `shuffleLook` จาก prototype ตรวจด้วย test เรื่องการสุ่มได้แต่ค่าในตาราง และข้ามหน้าตาที่ Agent อื่นมี, `lookOf` ของค่าว่างเป็นหน้าตาเริ่มต้น และช่องที่ไม่รู้จักเป็นตัวเลือกแรกโดยช่องอื่นคงเดิม
- [x] 1.2 เพิ่ม `entities/character/model/mood.ts` (`moodOf`) ตรวจด้วย test เรื่อง Mood ทั้งห้า, `turn.ended` ที่เป็น error ได้ว่าง, `tool_use` ค้างได้ทำงานแล้วกลับเป็นคิดเมื่อมี `tool.result`, Machine ที่ยังไม่รู้สถานะไม่นับว่าออฟไลน์ และ event ชนิดที่ไม่รู้จักถูกข้าม
- [x] 1.3 เพิ่ม `CharacterSchema` ใน `packages/protocol/src/messages/agent.ts` เป็น field ที่ไม่บังคับของ `agent.create` และของ Agent ใน `agent.listed` แล้วสร้าง `vectors/messages.json` ใหม่ด้วย `bun run --cwd packages/protocol fixtures` ตรวจด้วย vector ใหม่เรื่องสร้างพร้อม Character, ชิ้นส่วนที่ไม่รู้จักผ่าน, สีผิดรูปและชิ้นส่วนยาวเกินไม่ผ่าน และรายชื่อที่มี Character
- [x] 1.4 ให้ `supervisor/agents` เก็บ `character` ไปกับ Agent ใน `agents.json` ตรวจด้วย test ใน `flow.test.ts` เรื่องสร้างพร้อม Character แล้วเริ่ม supervisor ใหม่บน home เดิมยังได้ Character เดิมในรายชื่อ และส่งคำสั่งสร้างซ้ำด้วย Character อื่นไม่เปลี่ยนค่าเดิม
- [x] 1.5 เพิ่ม migration column `character` ในตาราง `agent` ของ Controller ให้ `saveAgents` เก็บค่าจาก `agent.listed` และ `createAgent` ของ `features/machine-link` รับ `character` แล้วส่งใน `agent.create` ตรวจด้วย test เดิมของ `links` ที่แก้ให้ส่ง Character และเห็นค่าในตาราง `agent` หลัง `agent.listed`
- [x] 1.6 ยก `Character.tsx` ของ prototype มาเป็น `entities/character/ui/Character.tsx` โดยตัด Mood รอ มือ `backdrop` และ `still` ตรวจด้วย `bun run check` ผ่าน (Steiger ไม่เตือนว่า entity import กัน) และการลองในข้อ 4.1

## 2. สถานะของ Task

- [x] 2.1 เปลี่ยน `LIST_TASK_SUMMARIES` ให้มี `kind` กับ `body` ของ event ล่าสุดที่รู้จักชนิด และให้ `statusOf` ตอบ `failed` พร้อมคำทั้งสองภาษาใน `entities/task` ตรวจด้วย test บน `bun:sqlite` เรื่อง Turn ที่จบด้วย error, Turn ที่ยังไม่จบ, Task ว่าง และ event ชนิดใหม่ที่มาท้ายสุด

## 3. Inbox

- [x] 3.1 ย้ายรายการของหน้าแรกกับ `inboxRows` ไป `widgets/agent-inbox` ใช้ Character กับ Mood ในแถว เพิ่ม `failed` ในลำดับ และย้ายคำไป namespace `agent-inbox` ตรวจด้วย test ของ `inboxRows` ที่เพิ่มแถวที่ล้มเหลว, `bun run check` ผ่านเรื่อง key ครบ และหน้าแรกบน iOS Simulator กับเว็บเหมือนเดิมยกเว้น Character
- [x] 3.2 เพิ่ม `useSplit` กับ `SIDEBAR_WIDTH` ใน `shared/ui/theme.ts`, แถบ Inbox ใน `RootLayout`, หน้าให้เลือก Agent ทางซ้ายพร้อมไอคอน `inbox`, หัวของหน้า Task ที่ไม่มีปุ่มย้อนกลับ และแถวที่เน้น Task ที่เปิดอยู่ ตรวจบนเว็บหน้าต่างกว้างกับแคบ และ iPad Simulator ว่าแตะสองแถวต่อกันแล้วแทนที่กัน ย่อหน้าต่างแล้ว Task เดิมยังอยู่ และล็อกแล้วแถบข้างหายไปด้วย

## 4. หน้า Task

- [x] 4.1 เพิ่มหัวของ log ที่มี Character 56 จุดซึ่งแตะแล้วเปิดหน้า Agent ชื่อ Machine กับเวลาเริ่ม เพิ่ม `LogFade` และให้สถานะที่หัวหน้าใช้ `statusOf` ตรวจบน iOS Simulator และเว็บกับ Runtime จริงและ Provider ปลอมว่า Character คิดแล้วเสร็จพร้อมกระโดดหมุน, เป็นว่างเมื่อ Provider ตอบ error และเป็นสีเทาเมื่อปิด `veeloe` ทั้งใน Inbox และหน้า Task
- [x] 4.2 ปิดปุ่มส่งระหว่าง Turn และเปลี่ยน placeholder ทั้งสองภาษา ตรวจบน iOS Simulator และเว็บว่าพิมพ์ระหว่าง Turn ได้แต่ส่งไม่ได้ และส่งข้อความที่พิมพ์ค้างไว้ได้ทันทีที่ Turn จบ

## 5. หน้า Agent

- [x] 5.1 ใช้ Character ในรายชื่อ Agent และหน้า Agent (Mood ว่างหรือออฟไลน์ตาม prototype) แล้วลบ `shared/ui/agent-avatar.tsx` ตรวจด้วย `bun run check` ผ่านโดยไม่มีที่ใดใช้ `AgentAvatar` และทั้งสองหน้าบน iOS Simulator กับเว็บ
- [x] 5.2 เพิ่ม Character 96 จุดกับปุ่มสุ่ม Character ใหม่ในหน้าสร้าง Agent ที่สุ่มหน้าตาด้วย `shuffleLook` แล้วส่งให้ `createAgent` ตรวจบน iOS Simulator ว่าสุ่มสองครั้งแล้วสร้าง Agent ใน Inbox มีหน้าตาแบบที่เห็นล่าสุด และยังเหมือนเดิมหลังปิดเปิดแอป

## 6. ปิดงาน

- [ ] 6.1 ลองทุกหน้าที่แตะบน iOS Simulator และเว็บ ทั้งสว่างและมืด ภาษาไทยและอังกฤษ และเปิดลดการเคลื่อนไหวว่า Character เปลี่ยนท่าทันทีโดยไม่ลอย แล้วรัน `bun run check` กับ `bun run test` ผ่าน
- [x] 6.2 เขียน `manual-checks.md` ให้เจ้าของลองบน iPhone และ iPad จริง (ความลื่นเมื่อมี Agent หลายตัว, ลดการเคลื่อนไหว, Inbox ข้าง Task) และแก้ `AGENTS.md` ถ้ามีอะไรที่ agent ต้องรู้เพิ่ม
