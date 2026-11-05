## 1. Protocol

- [x] 1.1 เพิ่ม `AgentUpdateBodySchema` (`id` กับ `name`, `provider`, `model`, `character` ที่ไม่บังคับ ต้องมีอย่างน้อยหนึ่งตัว และ `provider` ต้องมากับ `model`) ลงใน `parseMessage` พร้อม vector ใน `fixtures` ตรวจด้วย test ว่ามีแค่ `id` ไม่ผ่าน, `provider` โดยไม่มี `model` ไม่ผ่าน, `character` ผิดรูปไม่ผ่าน และ field ที่ไม่รู้จักผ่าน (ADR 0023)

## 2. Runtime

- [x] 2.1 เพิ่ม `replace` ใน `agent-registry` และ `update` ใน slice `agents` ที่ตรวจ Manage (`canManage` ที่ v0.1 ตอบ true ทุก Member ใน trust), Agent, Provider และ model ก่อนเขียนครั้งเดียว ตรวจด้วย test เรื่องเปลี่ยนชื่อแล้ว field อื่นเท่าเดิม, `agent.unknown`, Provider ที่ไม่มี, model ที่ไม่อยู่ในรายชื่อของ Provider ปัจจุบัน, Provider ที่ตอบรายชื่อไม่ได้, ชื่อไม่เปลี่ยนเมื่อ model ไม่ผ่าน และค่าอยู่รอดหลังเปิด registry ใหม่
- [x] 2.2 ส่ง `agent.listed` ถึงทุก Member ใน trust หลังเปลี่ยนสำเร็จ และ error ถึงคนสั่ง ต่อ `agent.update` ใน `onEnvelope` ตรวจด้วย test ใน `supervisor.test.ts` เรื่องซองจากกุญแจที่ไม่เชื่อหรือถูกถอนถูกทิ้ง
- [x] 2.3 ตรึง Provider กับ model ต่อ Task ใน `task-routes.json` ที่ route ของ proxy พร้อมกรณี Provider ที่ตรึงหายไป ตรวจด้วย test ใน `proxy.test.ts` หรือ `flow.test.ts` เรื่องเปลี่ยน model แล้ว Task เดิมยังไป model เดิม, Task ใหม่ไป model ใหม่, ค่าตรึงอยู่รอดข้ามการเริ่มใหม่ และ Task ที่ Provider ถูกลบย้ายไปค่าปัจจุบัน
- [x] 2.4 เพิ่ม IPC `{ kind: "agent", name }` ให้ supervisor ส่งเมื่อชื่อเปลี่ยน และให้ worker สร้าง system prompt ตอนเริ่มแต่ละ Turn จากชื่อล่าสุด ตรวจด้วย test ใน `agent.test.ts` เรื่อง Turn ถัดไปใช้ชื่อใหม่และ Turn ที่ทำอยู่ใช้ชื่อเดิม
- [x] 2.5 แก้ข้อความของ `veeloe provider remove` ให้บอกว่าเลือก Provider ใหม่ได้ที่หน้า Agent ในแอป ตรวจด้วย `cli.test.ts`

## 3. Controller

- [x] 3.1 เพิ่ม `updateAgent` กับ `updateError` ใน `features/machine-link` ตรวจด้วย test ใน `links.test.ts` เรื่องซอง `agent.update` ที่เซ็นแล้ว, ได้ `updateError` จาก error ที่ `ref` ตรง, `hub.machine_offline` และ Hub ไม่ได้ต่ออยู่คืน null
- [x] 3.2 ย้าย route ไป `app/agents/[agent]/index.tsx` แล้วเพิ่ม `model.tsx` กับ `character.tsx` ดึงส่วน Provider กับ model ของ `NewAgentPage` เป็น component ในสไลซ์ แล้วเพิ่ม `AgentModelPage` ที่บันทึกด้วยปุ่มบนหัว รอ `agent.listed` และไม่ติ๊กค่าที่ไม่อยู่ในรายชื่อ
- [x] 3.3 แก้ `AgentPage` ตาม prototype: แถว Character, ช่องชื่อกับปุ่มบันทึก, แถว Provider และ model, Note เมื่อ Machine ออฟไลน์ และคำเตือนเมื่อ Provider หรือ model ไม่อยู่บน Machine แล้ว พร้อม footer ใต้ช่องชื่อในหน้าสร้าง Agent ตรวจกฎคำเตือนด้วย test ของฟังก์ชันที่ตัดสินจาก Agent กับรายชื่อ Provider (หาย, model หาย, Provider ตอบ error, ยังไม่ได้รายชื่อ)
- [x] 3.4 เพิ่ม `pick`, `still` และ export ตัวเลือกใน `entities/character` แล้วเพิ่ม `pages/agent-character` ตาม `CharacterPage` ของ prototype ที่ส่งชิ้นส่วนที่ไม่รู้จักกลับตามเดิม ตรวจด้วย test เรื่องแก้แค่สีแล้วส่ง `shell` ที่ไม่รู้จักกลับไป
- [x] 3.5 เขียนคำไทยและอังกฤษของทุกหน้าใหม่ และแก้คำของ `provider.missing` ให้บอกให้เลือก Provider ใหม่ในหน้า Agent ตรวจด้วย `bun run check`
- [x] 3.6 ลองทุกหน้าบน iOS Simulator และเว็บ ทั้งสว่างและมืด ทั้งไทยและอังกฤษ พร้อมภาพหน้าจอ

## 4. ปิดงาน

- [x] 4.1 เพิ่ม e2e ที่รัน `veeloe` จริงกับ Provider ตัวแทน ตรวจว่า `agent.update` เปลี่ยน model แล้ว Task เดิมยังส่ง model เดิมไป Provider และ Task ใหม่ส่ง model ใหม่ และ Agent ที่ Provider ถูกลบกลับมาตอบได้หลังเลือก Provider ใหม่
- [ ] 4.2 แก้ `CONTEXT.md` ที่ Provider ถ้าคำตอบของคำถามเปิดข้อ 3 เปลี่ยนความหมายของ "มีผลตั้งแต่ Task ถัดไป" ลองตาม `manual-checks.md` แล้วติ๊ก `agent-settings` ใน `docs/roadmap.md` ใน commit ที่ archive
