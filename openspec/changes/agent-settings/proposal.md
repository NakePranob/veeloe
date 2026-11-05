## Why

สร้าง Agent แล้ว Owner แก้อะไรไม่ได้เลย ทั้ง Provider, model, ชื่อ และ Character หน้า Agent แสดง Provider กับ model ให้ดูอย่างเดียว ที่หนักกว่านั้นคือ Agent ที่ Provider ถูกลบด้วย `veeloe provider remove` ค้างถาวร ทุก Turn จบด้วย `provider.missing` และ CLI บอกว่า "หยุดตอบจนกว่าจะได้ Provider ตัวอื่น" แต่ยังไม่มีทางให้ Provider ตัวอื่น ทางเดียวคือสร้าง Agent ใหม่ ซึ่งได้ Workdir กับ Memory คนละชุด

ADR 0006 ให้การแก้ค่า Agent เป็นคำสั่งที่เซ็นไปที่ Runtime และ ADR 0042 ให้คนที่มี Manage เลือก Provider กับ model โดยมีผลตั้งแต่ Task ถัดไป change นี้ทำทั้งสองข้อให้เป็นจริง

## What Changes

- **Protocol:** ข้อความใหม่ `agent.update` (Controller → Machine) มี `id` กับ field ที่จะเปลี่ยนอย่างน้อยหนึ่งตัวจาก `name`, `provider`, `model`, `character` ตอบด้วย `agent.listed` แบบเดียวกับ `agent.create` (additive ตาม ADR 0023)
- **Runtime (supervisor):** ตรวจลายเซ็นและ Manage (v0.1 คือกุญแจใน trust ทุกดอก เพราะมี Owner คนเดียว) ตรวจว่า Provider อยู่บน Machine และ model อยู่ในรายชื่อของ Provider นั้น แล้วเขียนลง `agents.json` และส่ง `agent.listed` ถึงทุก Member ใน trust ไม่ใช่แค่คนสั่ง เครื่องอื่นของ Owner จึงเห็นค่าใหม่
- **Runtime (proxy):** Task ตรึง Provider กับ model ไว้ตั้งแต่คำขอแรกไป LLM เปลี่ยนแล้ว Task ที่เปิดอยู่ใช้ค่าเดิมจนจบ Task ใหม่ใช้ค่าใหม่ (ADR 0042) ยกเว้น Task ที่ Provider ตรึงไว้ถูกลบไปแล้ว ซึ่งย้ายไปใช้ค่าปัจจุบันของ Agent เพื่อให้ Task ที่ค้างอยู่กลับมาคุยต่อได้
- **Runtime (worker):** ไม่ต้องเริ่ม worker ใหม่ ชื่อใหม่ส่งให้ worker ทาง IPC และใช้ใน system prompt ตั้งแต่ Turn ถัดไป
- **Controller:** หน้า Agent แก้ชื่อได้ มีแถว Character ไปหน้าแก้ Character และแถว Provider กับ model ไปหน้าเลือกแบบแถวติ๊กเหมือนหน้าสร้าง Agent หน้า Agent บอกชัดเมื่อ Provider ของ Agent ไม่อยู่บน Machine แล้ว หรือ model ไม่อยู่ในรายชื่อแล้ว และพาไปเลือกใหม่
- **Controller:** หน้าแก้ Character ตาม `CharacterPage` ของ prototype ที่ `controller-task-screens` ตัดไว้รอข้อความนี้

## Capabilities

### New Capabilities
- `agent-settings`: Owner แก้ชื่อ Provider model และ Character ของ Agent หลังสร้างอย่างไร Runtime ตรวจและเก็บอย่างไร Task ที่เปิดอยู่ได้ผลแค่ไหน และเครื่องอื่นของ Owner รู้ได้อย่างไร

### Modified Capabilities
(ไม่มี capability ใน `openspec/specs/` ที่เปลี่ยน requirement ส่วน `runtime-agents`, `runtime-providers`, `controller-tasks` และ `controller-character` ยังอยู่ใน change ที่ยังไม่ archive จึงเขียนเป็น capability ใหม่ก้อนเดียว)

## Impact

- **Protocol:** `packages/protocol/src/messages/agent.ts` เพิ่ม `AgentUpdateBodySchema` ใน `parseMessage` พร้อม vector
- **Runtime:** `supervisor/agents/agents.ts` (คำสั่ง `update`), `supervisor/agent-registry/registry.ts` (`replace`), `supervisor/proxy` กับ route ใน `supervisor/index.ts` (ตรึงต่อ Task ในไฟล์ `task-routes.json`), `ipc.ts` กับ `worker/` (IPC `agent` ที่เปลี่ยนชื่อ), ข้อความของ `veeloe provider remove`
- **Controller:** `features/machine-link` (`updateAgent` กับ `updateError`), `pages/agents` (หน้า Agent, หน้าเลือก Provider กับ model), `pages/agent-character` ใหม่, route `app/agents/[agent]/` และคำทั้งไทยและอังกฤษ รวมถึงคำของ `provider.missing` ใน `shared/i18n/errors`
- **ไม่มี dependency ใหม่:** แอปจริงไม่มี `@expo/ui` กับ `expo-haptics` จึงใช้แถวติ๊กและไม่มี haptics
- **ลำดับ archive:** ต้อง archive `agent-and-task` กับ `controller-task-screens` ก่อน เพราะ spec ของ change นี้อ้าง `agent.create`, `agent.listed`, `agents.json`, proxy และ `character` จากสอง change นั้น
- **ยังไม่รวม:** ลบ Agent, คำอธิบาย, คำสั่งของ Agent, Budget, Approval หมดอายุ, Allowlist, Memory, Skill, Effort และสิทธิ์เข้าถึง ดูว่าแต่ละอย่างอยู่ change ไหนใน `design.md` การแก้ตอน Machine ออฟไลน์ยังไม่รอในคิวขาออก ดูคำถามเปิดใน `design.md`
