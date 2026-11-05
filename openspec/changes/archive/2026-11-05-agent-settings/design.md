## Context

วันนี้ Protocol มี `agent.create`, `agent.list` และ `agent.listed` (`packages/protocol/src/messages/agent.ts`) supervisor เก็บ Agent ใน `~/.veeloe/runtime/agents.json` ผ่าน `agent-registry` ซึ่งมีแค่ `all`, `get` และ `add` slice `agents` ตรวจ Provider กับ model ตอนสร้างด้วย `listModels` แล้วเริ่ม worker

ข้อเท็จจริงที่ใช้ตัดสินในเอกสารนี้:

- proxy หา route ทุกคำขอจาก `registry.get(agent)` (`supervisor/index.ts`) ถ้าแก้ `agents.json` เฉยๆ Task ที่ทำอยู่จะเปลี่ยน model ทันทีในคำขอถัดไป ซึ่งขัด ADR 0042 แต่ก็แปลว่า worker ไม่ต้องเริ่มใหม่เพื่อเปลี่ยน Provider หรือ model
- worker ได้ชื่อ Agent ทาง env `VEELOE_AGENT_NAME` ตอนเริ่ม และใช้ในประโยคแรกของ system prompt (`worker/core/agent.ts`) ชื่อจึงเป็น field เดียวที่ worker ต้องรู้
- worker ส่ง id ของ Task ใน header `x-veeloe-task` กับทุกคำขอ proxy จึงรู้ว่าคำขอเป็นของ Task ไหน
- `outbox.toMember(member, ...)` ส่งซองถึง Member Hub ส่งต่อให้ทุก Controller ของ Member นั้น ส่วน `agent.create` กับ `egress.set` วันนี้ตอบแค่คนสั่ง
- Controller เก็บ `agent.listed` ด้วย `INSERT OR REPLACE` (`entities/agent/model/agents.ts`) ค่าที่เปลี่ยนจึงไหลเข้าหน้าจอเองเมื่อได้รายชื่อใหม่
- Hub ยังไม่ได้เก็บโปรไฟล์ของ Agent ตามที่ ADR 0006 เขียนไว้ Controller รู้จัก Agent จาก `agent.listed` ของ Machine อย่างเดียว
- `veeloe provider remove` บอกอยู่แล้วว่า Agent ที่ใช้ Provider นั้น "หยุดตอบจนกว่าจะได้ Provider ตัวอื่น" แต่ยังไม่มีทางให้

## Goals / Non-Goals

**Goals:**
- Owner แก้ชื่อ Provider model และ Character ของ Agent จาก Controller ด้วยคำสั่งที่เซ็น
- Task ที่เปิดอยู่ใช้ Provider กับ model เดิมจนจบ (ADR 0042)
- Agent ที่ Provider ถูกลบกลับมาใช้ได้ รวมถึง Task เดิมของมัน
- เครื่องอื่นของ Owner เห็นค่าใหม่

**Non-Goals:**
- ลบ Agent (ดูคำถามเปิด)
- คำอธิบาย คำสั่งของ Agent และค่าอื่นที่ prototype มี (ดูตารางในหัวข้อหน้าจอ)
- คิวขาออกของ Controller สำหรับการแก้ตอน Machine ออฟไลน์ (ดูคำถามเปิด)
- โปรไฟล์ของ Agent ที่ Hub เพราะ Hub ยังไม่มี

## Decisions

### `agent.update` ส่งเฉพาะ field ที่เปลี่ยน

`{ id, name?, provider?, model?, character? }` ใช้ schema ของแต่ละ field ร่วมกับ `agent.create` มี refine ว่าต้องมี field อย่างน้อยหนึ่งตัว และ `provider` ต้องมากับ `model` ตอบด้วย `agent.listed` เหมือนคำสั่งอื่นของ Agent ไม่มีข้อความตอบใหม่ error ใช้ code ที่มีอยู่แล้ว คือ `agent.unknown`, `agent.provider_unknown` และ code จาก `listModels`

- **ทางอื่น: ส่งทั้ง Agent ทุกครั้ง** ง่ายกว่าตอนตรวจ แต่สองเครื่องที่แก้คนละ field พร้อมกันจะทับกัน และ Controller ที่เก่ากว่าจะลบ field ที่ตัวเองไม่รู้จัก
- **ทางอื่น: ข้อความแยกต่อ field** (`agent.rename`, `agent.set_model`) ชัดแต่ได้ข้อความสามสี่ตัวที่ทำงานเหมือนกัน

ข้อความเดียวตรวจทุก field ก่อน แล้วเขียนทั้งหมดหรือไม่เขียนเลย registry ได้ `replace(agent)` ที่เขียนไฟล์ทั้งก้อนเหมือน `add`

### สิทธิ์: Manage ซึ่งใน v0.1 คือกุญแจใน trust

ADR 0059 กับ CONTEXT ให้การแก้ค่า Agent เป็นสิทธิ์ Manage และ Owner มี Manage ที่ทุก Agent ใน v0.1 `trust.json` มีแค่ Owner จึงไม่ต้องตรวจเพิ่มจากลายเซ็น slice เขียนชื่อกฎไว้ในที่เดียว (`canManage(from, agent)` ที่ตอบ true สำหรับทุก Member ใน trust) เพื่อให้ v0.3 แก้ที่จุดเดียวตอนมี Grant ไม่ต้องยืนยันตัวใหม่ก่อนเซ็น เพราะ CONTEXT ไม่ได้ใส่การแก้ค่า Agent ไว้ในรายการที่ต้องยืนยันใหม่ (ต่างจาก Allowlist และ Egress)

### Provider กับ model ตรึงต่อ Task ที่ proxy

route ของคำขอหาแบบนี้: ถ้า Task มีค่าตรึงไว้และ Provider ที่ตรึงยังอยู่บน Machine ใช้ค่านั้น ไม่อย่างนั้นใช้ค่าปัจจุบันของ Agent แล้วตรึงไว้ ค่าที่ตรึงเก็บใน `~/.veeloe/runtime/task-routes.json` เป็น `{ [agent]: { [task]: { provider, model } } }` เขียนครั้งเดียวต่อ Task ตอนคำขอแรก ให้อยู่รอดข้ามการเริ่มใหม่ เพราะ thinking block ใน log ผูกกับ model ที่สร้างมันไม่ว่าเริ่มใหม่หรือไม่ คำขอที่ไม่มี header Task ใช้ค่าปัจจุบันโดยไม่ตรึง

Task ที่ Provider ที่ตรึงไว้หายไปแล้วย้ายไปค่าปัจจุบัน เพราะ Provider เดิมตอบไม่ได้อยู่แล้ว เรื่อง cache กับ thinking ที่ ADR 0042 กันไว้จึงไม่มีอะไรให้เสีย และเป็นทางเดียวที่ Task ที่ค้างจาก `provider.missing` คุยต่อได้ ส่วน Task ที่ model ที่ตรึงไว้หายจากรายชื่อแต่ Provider ยังอยู่ ไม่ย้าย ให้ Provider ตอบ error เอง เพราะ supervisor ไม่ถามรายชื่อ model ในทุกคำขอ

- **ทางอื่น: worker ตรึงเองใน `tasks.db` แล้วส่ง model มากับคำขอ** ไม่ต้องมีไฟล์ใหม่ใน supervisor แต่ worker ที่ถูกยึดเลือก model แพงเองได้ ซึ่ง ADR 0042 ให้เป็นของคนที่มี Manage
- **ทางอื่น: ตรึงในหน่วยความจำ** ไม่มีไฟล์ แต่ Task ที่เปิดค้างเปลี่ยน model หลังเริ่ม Runtime ใหม่
- **ทางอื่น: เปลี่ยนทันทีทุก Task** ง่ายที่สุด แต่ขัด ADR 0042

ponytail: ไฟล์โตหนึ่งบรรทัดต่อ Task ตัดออกพร้อมการลบ Task หรือ Agent เมื่อมี

### worker ไม่เริ่มใหม่

Provider กับ model อยู่ที่ proxy อยู่แล้ว Character เป็นแค่หน้าตา เหลือชื่อซึ่ง supervisor ส่งทาง IPC ใหม่ `{ kind: "agent", name }` worker เก็บชื่อไว้ในตัวแปร แล้วสร้าง system prompt ตอนเริ่มแต่ละ Turn แทนตอนเริ่ม worker Turn ที่ทำอยู่ใช้ชื่อเดิมจนจบ IPC ที่ส่งตอน worker กำลังเริ่มรอในคิว `waiting` แบบเดียวกับข้อความอื่น และ worker ที่เริ่มใหม่ภายหลังได้ชื่อจาก `agents.json` ทาง env ตามเดิม

- **ทางอื่น: เริ่ม worker ใหม่ตอนว่าง** ไม่ต้องมี IPC ใหม่ แต่ supervisor ต้องนับ Turn ที่ทำอยู่ และถ้าเริ่มใหม่กลาง Turn Turn นั้นจบเหมือนโดน Stop (ADR 0033)
- **ทางอื่น: ตรึงชื่อต่อ Task เหมือน model** ไม่มี cache ของ Task เดิมเริ่มใหม่ แต่ต้องเพิ่มคอลัมน์ใน `tasks.db` เพื่อเรื่องที่เกิดนานๆ ครั้ง ADR 0042 พูดถึง model ไม่ได้พูดถึงชื่อ

### ทุก Member ใน trust ได้ `agent.listed`

หลังเปลี่ยนสำเร็จ supervisor ส่ง `agent.listed` ถึงทุก Member ใน `trust.owners` ใน v0.1 คือ Owner คนเดียว Hub ส่งต่อถึงทุก Controller ของคนนั้น ADR 0034 ให้ชื่อและ Character ของ Agent เห็นได้ทุกคนใน Workspace อยู่แล้ว v0.3 ค่อยเลือกผู้รับจาก Grant ตาม ADR 0034 error ยังไปถึงคนสั่งคนเดียว

### Character ส่งกลับชิ้นส่วนที่ไม่รู้จัก

`lookOfJson` แปลงชิ้นส่วนที่ไม่รู้จักเป็นตัวแรกของแต่ละช่อง ถ้าส่งร่างนั้นกลับไปตรงๆ Controller รุ่นเก่าจะลบชิ้นส่วนที่รุ่นใหม่เลือกไว้ หน้าแก้ Character จึงจำช่องที่ Owner แตะ แล้วส่ง `{ ...character ที่ Machine ส่งมา, ...ช่องที่แตะ }`

### Controller: `updateAgent` กับสถานะของการบันทึก

`features/machine-link` ได้ `updateAgent(machine, body)` ที่ส่งด้วย `sendTo(machine, "update", ...)` และ `updateError` ใน `MachineStatus` แบบเดียวกับ `createAgent` กับ `createError` หน้าที่บันทึกรอจนได้ `agent.listed` ที่มีค่าใหม่ หรือได้ error ไม่แสดงค่าใหม่ก่อน Machine ยืนยัน (ADR 0006) Machine ออฟไลน์ (`useMachineStatus(...).online === false`) หรือ Hub ไม่ได้ต่ออยู่ ปิดปุ่มบันทึกพร้อม Note แบบเดียวกับหน้าสร้าง Agent

### หน้าจอตาม prototype

ทุกหน้าใช้แถวติ๊กแทนเมนูของ `@expo/ui` เหมือน `controller/src/pages/agents/ui/NewAgentPage.tsx` เพราะแอปจริงไม่มี `@expo/ui` และรายชื่อ model ของ gateway ยาวเป็นร้อยตัวพร้อมช่องค้นหา

| หน้า | ตาม | คงไว้ | เปลี่ยน |
|---|---|---|---|
| หน้า Agent | `controller-prototype/src/pages/agents/ui/AgentPage.tsx` | Character กับ Machine ด้านบน, ส่วน Task ที่มีอยู่แล้ว, ส่วน Agent ที่มีแถว Character และช่องชื่อกับปุ่ม บันทึก บนหัว, ส่วน Provider และ model พร้อม footer เรื่อง Task ถัดไป, การกันชื่อว่าง | `Select` สองตัวเป็นแถวเดียวที่ไปหน้าเลือก, `requireOnline` เป็นปุ่มที่ปิดพร้อม Note, เพิ่มคำเตือน Provider หรือ model ที่หายไป ซึ่ง prototype ไม่มีเพราะ Demo ไม่มีวันลบ Provider |
| หน้าเลือก Provider และ model (ใหม่ `pages/agents/ui/AgentModelPage.tsx`) | ส่วน Provider กับ model ของ `controller/src/pages/agents/ui/NewAgentPage.tsx` แทน `Select` ของ prototype | แถวติ๊ก Provider, แถวติ๊ก model 30 ตัวแรกกับช่องค้นหาเมื่อเกิน 8 ตัว, error ของ Provider ที่ตอบรายชื่อไม่ได้ | ดึงสองส่วนนี้ออกเป็น component ในสไลซ์ `pages/agents` ให้สองหน้าใช้ร่วม ปุ่ม บันทึก บนหัวเหมือนปุ่ม สร้าง ของหน้าสร้าง |
| หน้าแก้ Character (ใหม่ `pages/agent-character`) | `controller-prototype/src/pages/agent-character/ui/CharacterPage.tsx` | หัวขนาด 140, แถวตัวอย่าง Mood, สี, การ์ดชิ้นส่วนสี่ช่อง, สุ่มชิ้นส่วน, ร่างที่ทิ้งเมื่อยกเลิก, ปุ่ม ยกเลิก กับ เสร็จ บนหัว, ชื่อ Agent กับคำว่า Character บนหัว | เพิ่ม `pick`, `COLORS` ฯลฯ ที่ export และ prop `still` ใน `entities/character` ที่ `controller-task-screens` ตัดไว้ ปุ่ม เสร็จ รอ Machine ตอบก่อนปิด |
| หน้าสร้าง Agent | `controller-prototype/src/pages/agents/ui/NewAgentPage.tsx` | เพิ่ม footer ใต้ช่องชื่อว่า Character แก้ทีหลังได้ที่หน้า Agent และคำว่าเปลี่ยน Provider กับ model ทีหลังได้ใน footer | ไม่มีอย่างอื่น |

route ใหม่ `app/agents/[agent]/character.tsx` กับ `app/agents/[agent]/model.tsx` ต้องย้าย `app/agents/[agent].tsx` ไปเป็น `app/agents/[agent]/index.tsx` หน้าแก้ Character เปิดแบบ modal เหมือน prototype

สิ่งที่ prototype มีและ change นี้ไม่ทำ:

| สิ่งที่ตัด | ไฟล์ใน prototype | เพราะ | change ที่ถือ |
|---|---|---|---|
| ลบ Agent | `AgentPage.tsx` | ต้องมีข้อความใหม่, หยุด worker, ล้าง Task ใน Controller และตัดสินว่าโฟลเดอร์บนดิสก์อยู่ต่อไหม `entities/agent` ของแอปจริงเขียนไว้ว่า v0.1 ไม่ลบ Agent | ยังไม่มี ดูคำถามเปิด |
| คำอธิบายกับคำสั่งของ Agent | `AgentPage.tsx` | Protocol ไม่มีสอง field นี้ คำสั่งของ Agent เป็นค่าที่เซ็นตาม ADR 0038 | ยังไม่มีใน roadmap ของ v0.1 |
| Budget วันนี้, ตั้ง Budget | `AgentPage.tsx` | ยังไม่มี Budget | `daily-budget` |
| เพดาน Idle Work และ Watch | `AgentPage.tsx` | ยังไม่มี Idle Work กับ Watch | v0.2 |
| Approval หมดอายุ, แถว Allowlist | `AgentPage.tsx`, `AllowlistPage.tsx` | ยังไม่มี Approval | `approval-and-allowlist` |
| Mood รอ ในตัวอย่าง | `CharacterPage.tsx` | แอปจริงยังไม่มี Mood นี้ | `approval-and-allowlist` |
| แถว Memory | `AgentPage.tsx`, `MemoryPage.tsx` | ยังไม่มี Memory | `memory-and-compaction` |
| Skill, เว็บ, Connector, Schedule | `AgentPage.tsx` | v0.2 | v0.2 |
| Channel | `AgentPage.tsx` | v0.5 | v0.5 |
| สิทธิ์เข้าถึง, มุมมองแบบ Use ที่แก้ไม่ได้, Note ว่ามีแค่ Use | `AgentPage.tsx` | v0.1 มี Owner คนเดียว | v0.3 |
| Egress ต่อ Agent | `AgentPage.tsx`, `agent-egress/` | v0.1 มี Egress รายชื่อเดียวทั้ง Machine (ADR 0008) อยู่ที่หน้า Machine | หลัง v0.1 (ADR 0029) |
| context ของ model | `AgentPage.tsx` | Protocol ไม่ส่งขนาด context | `memory-and-compaction` ถ้าต้องใช้ |
| Effort | `Composer.tsx` | Protocol ไม่มี Effort | ยังไม่มี |
| haptics ตอนเลือกชิ้นส่วน | `CharacterPage.tsx` | แอปจริงไม่มี `expo-haptics` | เพิ่มได้ทีหลังด้วย `bunx expo install expo-haptics` |
| ป้าย Demo Workspace | `CharacterPage.tsx` | แอปจริงไม่ใช่ Demo | ยังไม่อยู่ใน roadmap ของ v0.1 |
| Note ว่าชื่อรอในคิวขาออก | `AgentPage.tsx`, `guard.ts` | ยังไม่มีคิวขาออก | ดูคำถามเปิด |

## Risks / Trade-offs

- [ชื่อที่เปลี่ยนทำให้ prompt cache ของ Task ที่เปิดอยู่เริ่มใหม่ครั้งหนึ่ง] → เปลี่ยนชื่อนานๆ ครั้ง และ model ยังตรึงไว้ thinking จึงไม่เสีย
- [Task ที่ย้าย Provider เพราะตัวเดิมหาย ส่ง thinking block ของ model เดิมไปให้ model ใหม่] → harness วันนี้ไม่เปิด thinking ถ้าเปิดทีหลังแล้ว Provider ใหม่ปฏิเสธ ต้องตัด thinking block ของ model อื่นใน `conversation()`
- [`task-routes.json` ไม่มีวันเล็กลง] → หนึ่งบรรทัดต่อ Task ต่อไปตัดพร้อมการลบ Task หรือ Agent
- [worker โกหก id ของ Task เพื่อใช้ค่าตรึงของ Task อื่น] → ได้แค่ Provider กับ model ที่คนที่มี Manage เคยเลือกให้ Agent ตัวเดียวกัน ไม่ข้าม Agent เพราะ Agent มาจาก IPC ไม่ใช่จากคำขอ
- [สองเครื่องแก้ field เดียวกันพร้อมกัน] → คำสั่งที่ถึง Machine ทีหลังชนะ และทุกเครื่องเห็นผลเดียวกันจาก `agent.listed`
- [Controller ที่เก่ากว่า change นี้ไม่รู้จัก `agent.update`] → ไม่มีผล เพราะเป็นข้อความขาออก และ `agent.listed` รูปเดิม

## Migration Plan

`agents.json` ไม่เปลี่ยนรูป `task-routes.json` ที่ไม่มีหมายถึงยังไม่มี Task ไหนตรึง Task ที่เปิดค้างก่อนอัปเดตจะตรึงตอนคำขอแรกหลังอัปเดต ซึ่งเป็นค่าปัจจุบันของ Agent อยู่แล้ว Controller ไม่มี migration ของฐานข้อมูล

## Open Questions

Owner ตัดสินครบแล้วทุกข้อ ตามค่าที่แนะนำ:

1. **field ที่แก้ได้:** ชื่อ, Provider, model และ Character ส่วนการลบ Agent แยกเป็น change `delete-agent` ใน roadmap
2. **Machine ออฟไลน์:** ปุ่มบันทึกใช้ไม่ได้และบอกว่า Machine ต้องออนไลน์ คิวขาออกตาม ADR 0006 เลื่อนไว้ก่อน
3. **Task เดิมเมื่อ Provider หาย:** ย้ายไปใช้ Provider และ model ปัจจุบันของ Agent
4. **ชื่อมีผลเมื่อไหร่:** ตั้งแต่ Turn ถัดไปของทุก Task
5. **ชื่อซ้ำ:** ยังไม่ตรวจ ทั้งตอนสร้างและตอนแก้
