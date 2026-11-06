## 1. Protocol

- [x] 1.1 เพิ่ม `budget` ใน `agent.update` (refine "nothing to change" นับด้วย), `agent.usage` และ field ไม่บังคับ `budget` กับ `usage` ของ Agent ใน `agent.listed` พร้อม vector ตรวจด้วย test เรื่อง `budget` ที่เป็น 0, ติดลบ, ทศนิยม และเกิน 10^12 ถูกปฏิเสธ, `agent.update` ที่มีแค่ `id` กับ `budget` ผ่าน และ `agent.listed` ที่ไม่มีสอง field ใหม่ยังผ่าน

## 2. supervisor

- [x] 2.1 เพิ่ม module `supervisor/budget/` ที่มี `budgetDay`, `createBudgets` กับ `usage.json` และ `usageIn` ตรวจด้วย test ด้วย `Clock` ปลอมเรื่อง 03:59 กับ 04:00, ยอดของวันก่อนนับเป็น 0, เริ่มใหม่ในวันเดียวกันแล้วยอดยังอยู่, Agent ที่ไม่มี `budget` ได้ 10M, สิทธิ์ 0600 และ `usageIn` กับ SSE ที่มี `message_delta` ยอดสะสม, JSON ทั้งก้อน และคำตอบที่ไม่มี `usage`
- [x] 2.2 ให้ `createLlmHandler` รับ `allow` กับ `onUsage` นับจากข้อความเต็มและตอบ `refuse(429, "budget.exhausted")` พร้อม `x-should-retry: false` เมื่อ `allow` เป็นเท็จ ตรวจด้วย test ใน `proxy.test.ts` ว่า Provider ไม่ได้คำขอ, `count_tokens` ผ่านและไม่ถูกนับ, ไบต์ของคำตอบที่ส่งถึง worker ไม่เปลี่ยน และ Task สองตัวที่ตรึง model ต่างกันนับเข้ายอดเดียว และ test ผ่าน `ipcFetch` กับ adapter `anthropic-llm` จริง (`llm-seam.test.ts`) ว่า SDK ส่งครั้งเดียวและได้ `LlmError("budget.exhausted")`
- [x] 2.3 ให้ slice `task-message` ปฏิเสธด้วย `budget.exhausted` และให้ `index.ts` ส่ง `agent.usage` ถึงทุก Member หลังทุกคำตอบที่นับ ตรวจด้วย test ว่าไม่มีข้อความถึง worker และ Agent ตัวอื่นยังรับข้อความได้
- [x] 2.4 ให้ slice `agents` เขียน `budget` จาก `agent.update` โดยไม่ถาม `listModels` เมื่อมีแค่ `budget` และใส่ `budget` กับ `usage` ใน `agent.listed` ตรวจด้วย test ใน `agents.test.ts` เรื่อง Agent ไม่มี, Member ที่ไม่มี Manage, Provider ล่มแต่ Budget ยังเปลี่ยน, `budget` คู่กับ model ที่ไม่ผ่านแล้วไม่เปลี่ยนอะไร และเพิ่ม Budget ตอนหมดแล้ว `task.message` ผ่าน
- [x] 2.5 ตรวจด้วย test ของ supervisor ทั้งตัวที่ใช้ worker จริงกับ Provider ปลอมว่า Turn ที่ยอดถึง Budget หลังรอบที่สองจบด้วย `turn.ended` code `budget.exhausted` โดยคำตอบรอบที่สองอยู่ใน log ครบ

## 3. Controller

- [x] 3.1 เพิ่ม migration ของคอลัมน์ `budget`, `usage_day` และ `usage_tokens`, เปลี่ยน `saveAgents` เป็น upsert และเพิ่ม `saveUsage` ตรวจด้วย test บน `bun:sqlite` เรื่องยอดเก่าไม่ทับยอดใหม่ทั้งวันเดียวกันและวันก่อน และ `agent.listed` ที่ไม่มี `budget` ไม่ลบค่าเดิม
- [x] 3.2 ให้ `features/machine-link` รับ `agent.usage` เขียนผ่าน `saveUsage` ตรวจด้วย test ใน `links.test.ts` ที่ใช้ Hub ปลอม
- [x] 3.3 ย้าย `Meter` กับ `formatTokens` จาก prototype แล้วเพิ่มส่วน Budget วันนี้ในหน้า Agent ที่ปุ่มบันทึกของหัวหน้าส่ง `updateAgent(machine, { id, name, budget })` ซองเดียว, เปอร์เซ็นต์ในรายชื่อ Agent และ `Note` ในหน้าสร้าง Agent ทั้งสองภาษา ตรวจบน iOS Simulator และเว็บ ทั้งสว่างและมืด รวมกรณี 85%, 100%, ใส่ค่าผิด, error จาก Machine และ Machine ออฟไลน์ (ตรวจ 85%/100% light+dark, รายชื่อ, ภาษาอังกฤษ, เว็บ และกฎค่าผิดด้วย unit test; เคส error/offline ยังเป็น manual check)
- [x] 3.4 เพิ่มการ์ด Budget หมดในหน้า Task และคำของ `budget.exhausted` ใน `errors` ทั้งสองภาษา ตรวจบน iOS Simulator และเว็บกับ Runtime จริงและ Provider ปลอม เรื่องหมดกลาง Turn, ส่งข้อความตอนหมด และเพิ่ม Budget แล้วพิมพ์ต่อใน Task เดิม (ตรวจการ์ด light+dark และอังกฤษบน iOS; mid-Turn/ส่งตอนหมด/เพิ่มแล้วคุยต่อด้วย e2e)

## 4. ปิดงาน

- [x] 4.1 เพิ่ม e2e ที่ตั้ง Budget ต่ำผ่าน `agent.update` คุยจนหมด แล้วตรวจว่าได้ `budget.exhausted` ทั้งใน Turn และตอนส่งข้อความถัดไป และหายเมื่อเพิ่ม Budget
- [x] 4.2 เขียน `manual-checks.md` ให้เจ้าของลองกับ Provider จริงบน iPhone และเว็บ และแก้ `AGENTS.md` ถ้ามีคำสั่งหรือไฟล์ใหม่ที่ต้องบอก
