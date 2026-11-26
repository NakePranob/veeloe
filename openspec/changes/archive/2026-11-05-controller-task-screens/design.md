## Context

- `agent-and-task` (commit `7b3aa8e`) วางหน้าแรก, Workspace, Machine, Agent, สร้าง Agent และ Task ตาม prototype แล้ว แต่ใช้ `shared/ui/agent-avatar.tsx` เป็นวงกลมกับไอคอนแทน Character ทุกที่ และตัด Character, Mood กับ Inbox ข้าง Task ไว้ให้ change นี้
- ข้อมูลที่ Controller มีจริงตอนนี้: ตาราง `agent` (`id`, `machine_id`, `name`, `provider`, `model`), `task`, `task_event` (`member.message`, `turn.started`, `llm.message`, `tool.result`, `turn.ended` ที่มี `reason` เป็น `done` หรือ `error`), `pending_message` และสถานะของ Machine จาก `features/machine-link` (`online` เป็น `true`, `false` หรือ `null` เมื่อยังไม่รู้)
- Protocol ไม่มีหน้าตาของ Character และไม่มีข้อความแก้ค่า Agent ADR 0006 ให้ Character เป็นค่าของ Agent ที่แก้ด้วยคำสั่งที่เซ็นไปที่ Runtime แล้ว Runtime อัปเดตสำเนาที่ Hub
- ADR 0022 ให้การคำนวณ Mood อยู่ใน `entities/character` และให้ test กฎของ Mood ส่วน UI ลองในแอปจริงบน iOS และเว็บ ไม่ใช้ snapshot test
- ADR 0065 ให้ทุกคำอยู่ใน `i18n/th.json` กับ `en.json` ของ slice ที่ใช้ และ `bun run check` ตรวจว่า key ครบทั้งสองภาษา
- `controller/` ยังไม่มี `react-native-svg` ซึ่ง prototype ใช้วาด Character

## Goals / Non-Goals

**Goals:**
- Inbox, หน้า Agent และหน้า Task หน้าตาและท่าทางเหมือน prototype โดยใช้แค่ข้อมูลข้างบน บวก field `character` ของ Agent ที่ Protocol กับ Runtime เพิ่มให้ ไม่แตะ Hub
- หน้าตาของ Agent ไม่เปลี่ยนเองเมื่อแอปรุ่นหลังเปลี่ยนสูตรหรือรายการชิ้นส่วน และเหมือนกันบน Controller ทุกเครื่องแม้คนละรุ่น
- Mood กับสถานะคำนวณที่เดียวจาก event ล่าสุด จึงไม่มีสองหน้าที่บอกไม่ตรงกัน

**Non-Goals:**
- ทุกอย่างในรายการ "ส่วนของ prototype ที่ตัดออก" ข้างล่าง
- ข้อความที่ LLM กำลังพิมพ์ทีละส่วน `agent-and-task` เขียนไว้ว่าจะเพิ่มใน change นี้ แต่ต้องเพิ่มข้อความใน Protocol และแก้ worker กับ supervisor ซึ่งเกินขอบเขต "บนข้อมูลที่มีจริง" จึงยกไปเป็นคำถามเปิด

## Decisions

### หน้าจอแต่ละหน้าตาม prototype ไฟล์ไหน

อ่านไฟล์ของ prototype ทั้งไฟล์ก่อนทำแต่ละหน้า แล้วยกโครง ระยะ และคำอธิบายในโค้ดมา ตัดเฉพาะส่วนในรายการข้างล่าง

| หน้าหรือชิ้นส่วน | ตาม prototype | ของจริงที่ได้ |
|---|---|---|
| Character | `src/entities/agent/ui/Character.tsx`, `src/entities/agent/model/look.ts` | `entities/character/ui/Character.tsx`, `entities/character/model/look.ts` |
| Mood | `moodOf` ใน `src/entities/task/model/state.ts` | `entities/character/model/mood.ts` |
| สถานะของ Task | `src/entities/task/ui/TaskStatus.tsx`, `STATUS_LABEL` กับ `statusOf` ใน `state.ts` | `entities/task` เดิม (`TaskStatusLabel`, `statusOf`) เพิ่ม `failed` |
| Inbox | `src/widgets/agent-inbox/ui/AgentInbox.tsx`, `src/pages/inbox/ui/InboxPage.tsx` | `widgets/agent-inbox/` (ย้ายรายการกับ `inboxRows` ออกจาก `pages/home`) และ `pages/home` |
| Inbox ข้าง Task | `Sidebar` กับ `Stack.Screen` ของ `index` และ `tasks/[task]` ใน `src/app/layouts/RootLayout.tsx`, `useSplit` กับ `SIDEBAR_WIDTH` ใน `src/shared/ui/theme.ts` | `app/layouts/RootLayout.tsx`, `shared/ui/theme.ts` |
| หน้า Task | `src/pages/task/ui/TaskPage.tsx` (หัวของ log, `LogFade`, หัวหน้าในจอกว้าง), `src/pages/task/ui/Composer.tsx` (placeholder ตอน `busy`) | `pages/task/ui/TaskPage.tsx` |
| รายชื่อ Agent | `src/pages/agents/ui/AgentsPage.tsx` | `pages/agents/ui/AgentsPage.tsx` |
| หน้า Agent | `src/pages/agents/ui/AgentPage.tsx` (Character 96 จุด Mood ว่างหรือออฟไลน์ ใต้มีชื่อ Machine) | `pages/agents/ui/AgentPage.tsx` |
| สร้าง Agent | `src/pages/agents/ui/NewAgentPage.tsx` (Character 96 จุดกับปุ่มสุ่ม Character ใหม่) | `pages/agents/ui/NewAgentPage.tsx` |

ทุก path ของ prototype อยู่ใต้ `controller-prototype/` และของจริงอยู่ใต้ `controller/src/`

prototype วาง Character ไว้ใน `entities/agent` และ Mood ไว้ใน `entities/task` ซึ่งไม่ตรงกับ ADR 0022 ที่ให้ Mood อยู่ใน `entities/character` ของจริงทำตาม ADR และไม่แก้ prototype เพราะเป็นแค่ที่วางไฟล์ ไม่ใช่หน้าตา

### ส่วนของ prototype ที่ตัดออก

| ส่วน | อยู่ใน prototype ที่ | เหตุผล | change เจ้าของ |
|---|---|---|---|
| Mood รอ, มือสีส้มที่โบก, prop `backdrop` ที่มีไว้ตัดขอบมือ, สถานะรออนุมัติ, `ApprovalCard`, preview แบบ mono ของคำสั่งที่รอ และการเรียงแถวที่รอไว้บนสุด | `Character.tsx`, `state.ts`, `TaskStatus.tsx`, `AgentInbox.tsx`, `TaskPage.tsx` | ยังไม่มี event ของ Approval | `approval-and-allowlist` |
| รายการคำสั่งที่ Agent รัน (`ToolCalls`, `items` ที่รวมคำสั่งติดกัน) | `ToolCalls.tsx`, `pages/task/model/items.ts` | รูปของ input ของ bash กำหนดใน change นั้น Mood ทำงานใช้แค่ว่ามี `tool_use` ค้าง จึงทำได้ใน change นี้ | `sandboxed-commands` |
| ปุ่มหยุด, การ์ด Turn ถูกขัดจังหวะ, สถานะ `interrupted` และกฎว่า Turn ที่ถูกหยุดเป็น Mood ว่าง | `Composer.tsx`, `TaskPage.tsx`, `state.ts` | ยังไม่มี event `stop` กับ `interrupted` | `stop-and-restart` |
| ป้ายรอคิว และ placeholder ว่าข้อความจะส่งต่อหลัง Turn จบ | `TaskPage.tsx`, `Composer.tsx` | Machine ยังปฏิเสธด้วย `agent.busy` change นี้จึงปิดปุ่มส่งแทน | `one-writer-queue` |
| การ์ด Budget หมดกับพร้อมใช้ สถานะ `budget` และ Budget วันนี้ในรายชื่อ Agent | `TaskPage.tsx`, `state.ts`, `AgentsPage.tsx` | ยังไม่มี Budget | `daily-budget` |
| แนบไฟล์ และการ์ดไฟล์ที่ Agent ส่ง | `Composer.tsx`, `TaskPage.tsx` | ยังไม่มี Attachment | `attachments` |
| ป้ายย่อ context แล้ว | `TaskPage.tsx` | ยังไม่มี compaction | `memory-and-compaction` |
| `PushBanner` | `src/widgets/push-banner/` | ยังไม่มี push | `push-notifications` |
| ตัวแก้ Character (`CharacterPage`, แถว Character ในหน้า Agent, ตัวอย่าง Mood ทั้งหก, `pick`, prop `still`, haptics) และคำว่าแก้ Character ทีหลังได้ใต้ช่องชื่อในหน้าสร้าง Agent | `src/pages/agent-character/`, `AgentPage.tsx`, `NewAgentPage.tsx`, `look.ts`, `Character.tsx` | ต้องมีข้อความ `agent.update` ที่เซ็นไปที่ Runtime (ADR 0006) ซึ่งยังไม่มี change ไหนใน roadmap ถือ | ยังไม่มี ดูคำถามเปิด |
| คำอธิบายกับคำสั่งของ Agent และค่าอื่นในหน้า Agent | `AgentPage.tsx`, `AgentsPage.tsx`, `NewAgentPage.tsx` | `agent-and-task` ตัดไว้แล้วด้วยเหตุผลเดียวกัน | ยังไม่มี เหมือนข้อบน |
| Effort | `Composer.tsx` | Protocol ไม่มี Effort และเป็น Non-Goal ของ `agent-and-task` | ยังไม่มี |
| ชื่อของ Task ใต้ Character และหลังสถานะใน Inbox | `TaskPage.tsx`, `AgentInbox.tsx` | Task ไม่มีชื่อในข้อมูล | ยังไม่มี |
| Team, Project, Worktree, Task ย่อย, Ask และ Mention | `AgentInbox.tsx`, `TaskPage.tsx`, `Composer.tsx` | v0.4 | v0.4 (ADR 0064) |
| สิทธิ์ของ Member, การเปิด Task ให้คนที่มี Use เห็น, ชื่อคนส่ง และ Task ที่อ่านไม่ได้ | `AgentInbox.tsx`, `TaskPage.tsx` | v0.1 มี Owner คนเดียว | v0.3 |
| Task จาก Channel | `TaskPage.tsx` | v0.5 | v0.5 |
| ป้าย Demo Workspace | `AgentInbox.tsx`, `CharacterPage.tsx` | แอปจริงไม่ใช่ Demo | Demo Workspace ของ ADR 0024 ยังไม่อยู่ใน roadmap ของ v0.1 |

ส่วนที่ของจริงทำต่างจาก prototype ไปแล้วใน `agent-and-task` คงไว้ตามเดิม คือการจัดคีย์บอร์ดกับการเลื่อนไปข้อความล่าสุดในหน้า Task (ผ่านข้อ 2.2 และ 2.3 ของ `manual-checks.md` ของ `agent-and-task` แล้ว), การเลือก Provider กับ model ด้วยแถวที่มีเครื่องหมายถูก และหน้าว่างเมื่อยังไม่มี Machine หรือ Agent

### วาด Character ด้วย `react-native-svg` ตาม prototype

ยก `Character.tsx` ของ prototype มาทั้งไฟล์ แล้วลบส่วนที่ตัดออกข้างบน คือ Mood รอ มือ `backdrop` และ `still` ของจริงจึงมี `look`, `mood` และ `size` หัวแบ่งเป็นชั้น SVG บนตาราง 100 × 100 แต่ละชั้นขยับด้วย `Animated` ของ React Native ท่าทางทั้งหมดอยู่ในตาราง `POSE` กับ `FLOAT` และเมื่อเครื่องตั้งให้ลดการเคลื่อนไหวก็เปลี่ยนท่าทันที token `ground` ใน `theme.ts` ของจริงมีอยู่แล้ว เพิ่ม dependency `react-native-svg` 15.16.0 รุ่นเดียวกับ prototype ซึ่งมีใน Expo Go จึงไม่ต้อง build native ใหม่

ทางเลือกที่ตัดออก:
- Skia: ต้อง build native ใหม่ และบนเว็บต้องโหลด CanvasKit ราวหลาย MB เพื่อวาดหัวขนาด 44 จุด
- รูปภาพหรือ Lottie: หน้าตามี 2,560 แบบที่ประกอบจากชิ้นส่วน และท่าทางขยับชั้นแยกกัน ทำเป็นไฟล์ล่วงหน้าไม่ได้
- วาดด้วย `View` ล้วน: เส้นโค้งของเปลือกกับครีบทำไม่ได้

### หน้าตาของ Character ถูกเก็บไว้กับ Agent บน Machine

เจ้าของเลือกทางนี้ (ทางที่สองในคำถามเปิดเดิม) เพราะหน้าตาที่คิดจาก hash ของรหัสจะเปลี่ยนเองเงียบๆ เมื่อสูตรหรือรายการชิ้นส่วนเปลี่ยนในแอปรุ่นหลัง และ Controller สองเครื่องที่แอปคนละรุ่นจะวาด Agent ตัวเดียวกันต่างกัน

- หน้าสร้าง Agent สุ่มหน้าตาด้วย `shuffleLook` ที่ยกมาจาก `look.ts` ของ prototype ให้ไม่ซ้ำกับ Agent ที่ Controller รู้จัก ลองไม่เกิน 50 ครั้ง ปุ่มสุ่ม Character ใหม่สุ่มหน้าตาใหม่ รหัสของ Agent ยังสร้างใน `createAgent` ของ `features/machine-link` เหมือนเดิม ซึ่งเปลี่ยนแค่ให้รับ `character` จากหน้าแล้วส่งไปใน `agent.create`
- `CharacterSchema` ใน `packages/protocol` เป็น object ที่ไม่ strict มี `color` เป็น `#rrggbb` และ `shell`, `top`, `sides`, `decal` เป็นคำสั้นตัวพิมพ์เล็กไม่เกิน 32 ตัว field นี้ไม่บังคับทั้งใน `agent.create` และใน Agent ของ `agent.listed` ค่าที่ผิดรูปทำให้ทั้งข้อความไม่ผ่านตามแบบของ field อื่น ชิ้นส่วนตรวจเป็นคำที่มีขอบเขต ไม่ใช่รายการปิด เพราะ ADR 0023 ให้ฝั่งรับข้ามสิ่งที่ไม่รู้จัก Runtime รุ่นเก่าจึงต้องเก็บชิ้นส่วนใหม่ของ Controller รุ่นใหม่ได้ ส่วน Controller ที่ไม่รู้จักชิ้นไหนใช้ตัวเลือกแรกของช่องนั้นด้วย `lookOf` ของ prototype
- supervisor ใส่ `character` ลงใน Agent ที่บันทึกใน `agents.json` เมื่อคำสั่งมีมา แล้วส่งกลับใน `agent.listed` ทุกครั้ง คำสั่งที่ส่งซ้ำด้วยรหัสเดิมไม่แก้หน้าตาที่เก็บไว้ เพราะ `agent.create` ไม่ใช่คำสั่งแก้ค่า
- Controller เก็บ `character` เป็น JSON ใน column ใหม่ของตาราง `agent` (migration ต่อท้าย) แล้วแปลงด้วย `lookOf` ตอนวาด
- Agent ที่สร้างก่อน change นี้ไม่มี `character` จึงได้หน้าตาเริ่มต้นแบบเดียว คือตัวเลือกแรกของทุกช่อง (`lookOf({})`) ไม่คิดจากรหัส เพราะจะกลับไปมีปัญหาเดิม

การแก้หน้าตาหลังสร้างอยู่นอก change นี้ ต้องมีข้อความ `agent.update` ที่เซ็นไปที่ Runtime ตาม ADR 0006 ซึ่งยังไม่มี change ไหนใน roadmap ถือ เป็นงานต่อจากนี้พร้อมตัวแก้ Character ของ prototype

ทางเลือกที่ตัดออก:
- คิดหน้าตาจากรหัสของ Agent ด้วย FNV-1a (ค่าเริ่มต้นเดิมของ design นี้): ไม่ต้องแก้ Protocol หรือ Runtime และ Agent ที่มีอยู่ได้หน้าตาต่างกันทันที แต่หน้าตาเปลี่ยนเองเมื่อสูตรหรือรายการชิ้นส่วนเปลี่ยน และต่างกันระหว่างแอปคนละรุ่น
- เก็บหน้าตาในฐานข้อมูลของ Controller อย่างเดียว: แต่ละเครื่องจะเห็นไม่เหมือนกันเมื่อมี Linking
- ตรวจชิ้นส่วนเป็นรายการปิดใน Protocol: Runtime รุ่นเก่าจะปฏิเสธ `agent.create` จาก Controller ที่มีชิ้นส่วนใหม่ ซึ่งขัดกับ ADR 0023

### Mood กับสถานะได้จาก event ล่าสุดที่รู้จักชนิด

`moodOf(last, online)` ใน `entities/character` รับ event ล่าสุดที่ชนิดอยู่ใน `TaskEventKind` ของ `@veeloe/protocol` (เป็น `{ kind, body }` จึงไม่ต้อง import `entities/task` ซึ่ง Steiger ห้าม) กับสถานะของ Machine แล้วตอบตามตารางใน spec `controller-character` คือ `online === false` เป็นออฟไลน์, ไม่มี event เป็นว่าง, `turn.ended` ที่ `reason` เป็น `done` เป็นเสร็จ และเป็น `error` เป็นว่าง, `llm.message` ที่ `content` มี block `tool_use` เป็นทำงาน และที่เหลือ (`member.message`, `turn.started`, `tool.result`, `llm.message` ที่ไม่มี `tool_use`) เป็นคิด

ทำได้เพราะ worker เขียน event ตามลำดับเดียวเสมอ: ข้อความของ Member → `turn.started` → คำตอบของ LLM สลับกับผลของ tool → `turn.ended` ข้อความที่ถูกปฏิเสธด้วย `agent.busy` ไม่ถูกเขียนลง log

`statusOf` ใน `entities/task` ใช้ event ล่าสุดเดียวกัน: ออฟไลน์, ยังไม่ได้เริ่มเมื่อไม่มี event, `failed` เมื่อ `turn.ended` จบด้วย error, เสร็จแล้วเมื่อจบปกติ และกำลังทำงานเมื่อยังไม่มี `turn.ended` ปิด `LIST_TASK_SUMMARIES` เปลี่ยนจากนับ `turn.started` กับ `turn.ended` เป็นเลือก `kind` กับ `body` ของ event ล่าสุดที่ชนิดอยู่ในรายการ แล้ว Inbox กับหน้า Agent ส่งค่านั้นให้ทั้งสองฟังก์ชัน หน้า Task หยิบตัวสุดท้ายที่รู้จักจาก `useTaskEvents` ที่มีอยู่แล้ว

Mood ทำงานใช้ได้ทันทีที่ `sandboxed-commands` ให้ Agent มี tool จริง โดยไม่ต้องแก้ที่นี่อีก

ทางเลือกที่ตัดออก:
- คิดจาก event ทั้ง log แบบ prototype: Inbox ต้องโหลด event ทุก Task มาทุกครั้งที่มีอะไรเปลี่ยน ทั้งที่ event ล่าสุดก็บอกได้เท่ากันเมื่อยังไม่มี Approval เมื่อ `approval-and-allowlist` มา Approval ที่ค้างจะอยู่ใน summary เป็นอีก column
- Mood ติดขัดสำหรับ Turn ที่จบด้วย error: prototype เขียนไว้ว่ารอ Turn ที่จบด้วย error ได้ ซึ่งตอนนี้มีแล้ว แต่ prototype ยังไม่มีท่านี้ ดูคำถามเปิด

### Inbox เป็น widget ที่หน้าแรกกับแถบข้างใช้ร่วมกัน

รายการ, `inboxRows` กับ test และคำของแถวกับหน้าว่างย้ายจาก `pages/home` ไป `widgets/agent-inbox` เพราะ `app/` กับ `pages/home` ต้องใช้รายการเดียวกัน และ FSD ห้าม page import กันเอง `inboxRows` เพิ่ม `failed` ในลำดับระดับเดียวกับเสร็จแล้ว จึงเรียงตามเวลาร่วมกัน

`useSplit()` เป็นจริงเมื่อหน้าต่างกว้างตั้งแต่ 960 จุด แล้ว `RootLayout` วางการ์ด Inbox กว้าง 360 จุดข้าง `Stack` ภายใน `View` ที่ซ่อนตอนล็อก หน้า `index` ซ่อนหัวและแสดงว่าให้เลือก Agent ทางซ้าย หน้า `tasks/[task]` ไม่มีปุ่มย้อนกลับ แถวในแถบข้างใช้ `router.replace` และแถวของ Task ที่เปิดอยู่ (จาก `useGlobalSearchParams`) ถูกเน้นด้วยสี `chip` `Stack` อยู่ที่เดิมใน tree ทั้งสองแบบ การย่อขยายจึงไม่ล้างการนำทาง และ `unstable_settings.anchor` เดิมให้ย้อนไปหน้าแรกได้เมื่อหน้าต่างแคบลง

### หน้า Task

- หัวของ log มี Character 56 จุดที่แตะแล้วเปิดหน้า Agent ใต้มีชื่อ Machine กับเวลาที่ event แรกเข้ามา หรือคำว่ายังไม่ได้เริ่ม
- `LogFade` ยกมาจาก prototype เป็นเส้นจางสูงศูนย์ที่วาดทับท้าย log เหนือช่องพิมพ์
- ระหว่าง Turn ปุ่มส่งปิด และ placeholder บอกว่าส่งได้เมื่อ Turn นี้จบ ข้อความที่พิมพ์ค้างไว้ไม่หาย ช่องพิมพ์ยังอยู่ใน `TaskPage.tsx` ไม่แยกไฟล์ เพราะยังสั้น
- สถานะที่หัวหน้าใช้ `statusOf` จากข้างบน แทนการคิดเองในหน้า

### คำใหม่

คำใหม่ทุกคำอยู่ใน `i18n/th.json` กับ `en.json` ของ slice ที่ใช้: `failed` ใน `entities/task`, namespace `agent-inbox` ใหม่ของ widget (ย้ายคำของแถวและหน้าว่างมาจาก `home`), คำให้เลือก Agent ทางซ้ายใน `home`, คำของช่องพิมพ์ตอน Turn ยังไม่จบกับเวลาเริ่มใน `task` และปุ่มสุ่มใน `agents` แล้วลงทะเบียน namespace ใหม่ใน `app/i18n/resources.ts` Character ไม่มีคำ เพราะซ่อนจากโปรแกรมอ่านหน้าจอ เพิ่มไอคอน `inbox` ใน `shared/ui/icon.tsx` สำหรับหน้าให้เลือก Agent

## Risks / Trade-offs

- [worker พังกลาง Turn แล้วไม่มี `turn.ended` ตามมา Character จึงคิดค้าง และสถานะกำลังทำงานค้าง] → ปิด Turn ที่ค้างด้วย event ตาม ADR 0033 อยู่ใน `stop-and-restart` ระหว่างนี้ส่งข้อความใหม่ไม่ได้จนกว่าจะเริ่ม `veeloe` ใหม่ ซึ่งเหมือนก่อน change นี้
- [Character ที่ขยับทุกแถวใน Inbox บนเว็บไม่มี native driver จึงขยับด้วย JS] → v0.1 มี Agent ไม่กี่ตัว และ `FlatList` วาดเฉพาะแถวที่เห็น ถ้าช้าบนเครื่องจริง ค่อยหยุดการลอยของแถวที่ไม่ได้อยู่บนจอ
- [Agent ที่สร้างก่อน change นี้ได้หน้าตาเริ่มต้นแบบเดียวกันหมด] → v0.1 ยังไม่ได้ปล่อย จึงมี Agent แบบนี้แค่บนเครื่องของคนทำ และแก้ได้เมื่อมี `agent.update` กับตัวแก้ Character
- [Runtime ที่เก่ากว่า change นี้ไม่เก็บ `character` จึงตอบ Agent ใหม่โดยไม่มีหน้าตา] → Controller วาดหน้าตาเริ่มต้นแทน และ Runtime อัปเดตเองตาม ADR 0009
- [Mood คิดจาก event ล่าสุด จะไม่พอเมื่อมี Approval ที่ค้างอยู่ระหว่าง event อื่น] → `approval-and-allowlist` เพิ่มข้อมูลของ Approval ที่ค้างใน summary และให้มาก่อนตามลำดับของ prototype
- [`react-native-svg` เพิ่มขนาด bundle บนเว็บ] → เป็นตัวเดียวกับที่ prototype ใช้อยู่ และไม่มีทางวาดเส้นโค้งที่ถูกกว่านี้

## Migration Plan

ฐานข้อมูลของ Controller ได้ migration ต่อท้ายหนึ่งข้อ คือ column `character` ที่เป็น null ได้ในตาราง `agent` แถวเดิมจึงเป็น null และได้หน้าตาเริ่มต้น `agents.json` ของ Runtime ไม่ต้อง migrate เพราะ Agent ที่ไม่มี `character` ยังอ่านได้ ต้อง archive `agent-and-task` ก่อน change นี้ เพราะ spec `controller-tasks` กับ `runtime-agents` สร้างใน change นั้น ถอยกลับได้ด้วยการ revert commit: `character` ที่เก็บไปแล้วเป็น field ที่โค้ดเดิมข้ามไป และ column ที่เพิ่มแล้วอยู่ต่อได้โดยไม่มีใครอ่าน

## Open Questions

ทุกข้อเลือกค่าเริ่มต้นไว้แล้วในข้างบน และทำตามนั้นได้เลย เจ้าของเปลี่ยนได้ก่อนเริ่มทำ

- **วิธีวาด Character**: เลือก `react-native-svg` ตาม prototype ทางเลือกอยู่ในหัวข้อการวาด
- **ตัวแก้ Character และ `agent.update` ที่เซ็นแล้ว** (งานต่อจากนี้): ยังไม่มี change ใน roadmap ถือ ควรเพิ่มบรรทัดใหม่ เช่น `agent-settings` ที่รวมชื่อ คำอธิบาย คำสั่ง และ Character หรือไม่
- **Mood ของ Turn ที่จบด้วย error**: เลือกว่าง และให้สถานะบอกว่าล้มเหลว อีกทางคือเพิ่มท่าติดขัดใน prototype ก่อน แล้วค่อยยกมา
- **ข้อความที่ LLM กำลังพิมพ์ทีละส่วน**: `agent-and-task` เขียนว่าจะมาใน change นี้ แต่ change นี้ตัดออก ควรเป็นบรรทัดใหม่ใน roadmap หรือไม่
- **Inbox ข้าง Task บนจอกว้าง**: ใส่ไว้เพราะเป็นส่วนของ Inbox ใน prototype และไม่ต้องใช้ข้อมูลใหม่ ถ้าอยากให้ change เล็กลง ตัดข้อ 3.2 ออกได้โดยไม่กระทบข้ออื่น
