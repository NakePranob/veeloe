## 0. ฐาน

งานนี้ต่อจาก change `daily-budget` ซึ่งยังไม่ archive ถ้า `daily-budget` ยังไม่ปิด ให้ทำข้อ 1 ของมันให้เสร็จก่อน แล้วค่อยเริ่มข้อ 1 ของที่นี่

## 1. Protocol

- [x] 1.1 เพิ่ม `packages/protocol/src/messages/usage.ts` ที่มี `UsageDaySchema` (`YYYY-MM-DD`), `UsageGetBodySchema` (`request` 1–64 ตัวอักษร, `days` จำนวนเต็ม, `agent` ไม่บังคับ) และ `UsageListedBodySchema` (`request`, `from`, `to`, `agents[]` ที่มี `days`, `tasks`, `sources`) ลงทะเบียน `usage.list` กับ `usage.listed` ใน `messages/index.ts` export จาก `index.ts` และเพิ่ม vector ใน `fixtures/build.ts` เรื่อง `request` หาย, days ไม่ใช่จำนวนเต็ม, `from`/`to` ที่ไม่ใช่วัน, `from` หลัง `to`, tokens ติดลบ และ tasks เกิน 20 ถูกปฏิเสธ (ขอบเขต 1–90 ของ days ตรวจที่ slice ในข้อ 2.4)

## 2. Runtime

- [x] 2.1 เพิ่ม `packages/runtime/src/supervisor/usage/store.ts` ที่เปิด `usage.db` ใน `supervisorDir(home)` ตั้งสิทธิ์ 0600 สร้างตาราง `usage (agent, day, source, task, tokens)` พร้อม index และมี `add`, `total`, `range`, `prune`, `importLegacy` ตรวจด้วย test เรื่องการบวกซ้ำในแถวเดียว, `range` คืนเฉพาะวันที่มีแถว, Task มากที่สุด 20 อัน, ผลรวมตามแหล่งที่มา, prune ตามวันของ Budget, เริ่มใหม่แล้วยอดอยู่, นำเข้า `usage.json` ครั้งเดียวแล้วเปลี่ยนชื่อไฟล์, `usage.json` เสียแล้ว import ล้ม และสิทธิ์ไฟล์ 0600

- [x] 2.2 ให้ `supervisor/budget/budget.ts` อ่านและเขียนผ่าน store แทน `usage.json` โดย `add(agent, task, tokens)` คืนยอดของวันนั้น และ `usageIn`/`limitOf`/`exhausted`/`listedOf` ทำงานเหมือนเดิม ตรวจด้วย test เดิมของ budget ที่ต้องผ่านทั้งหมด และ test ว่ายอดของวันนี้คือผลรวมจาก store พร้อมรหัส Task ของคำตอบนั้น

- [x] 2.3 ให้ `createLlmHandler` ส่ง `onUsage(agent, task, tokens)` โดย `task` มาจากหัว `x-veeloe-task` หรือ `undefined` และให้ `index.ts` ส่งต่อเข้า store เป็น `task=''` เมื่อไม่มี ตรวจด้วย test ใน `proxy.test.ts` ว่า Task สองตัวได้คนละแถว, คำขอที่ไม่มีหัว Task ได้ `task=undefined`, `count_tokens` ไม่เขียนแถว และการเขียน store ล้มเหลวไม่ทำให้คำตอบของ Provider หาย (log แล้วตอบต่อ)

- [x] 2.4 เพิ่ม slice `supervisor/usage/usage.ts` ที่รับ `usage.list` ตรวจ Manage, ตรวจ `days` 1–90, คำนวณ `from`/`to` จาก `budgetDay` ของ Machine แล้วตอบ `usage.listed` ถึงผู้ขอคนเดียว ตรวจด้วย test ว่า Agent ที่ไม่มีหรือไม่มี Manage ได้ `agent.unknown`, days นอกช่วงได้ `usage.invalid_range`, คำตอบมี `request` เดิมและ `from`/`to` ของ Machine, ไม่มีวันว่างถูกเติมเป็นศูนย์ และ Task ที่มีรหัสว่างไม่โผล่ใน `tasks`

- [x] 2.5 ตรวจด้วย flow test ที่ใช้ worker จริงกับ Provider ปลอม: คุยสอง Task ในวันเดียว ขอ `usage.list` ด้วย `days: 1` แล้วได้ยอดแยกตาม Task และผลรวมตรงกับที่ Provider รายงาน, ขอ `days: 7` แล้วได้ `from`/`to` ตามวันของ Machine และ Agent อีกตัวไม่ถูกปนเข้ามา

## 3. Controller data

- [x] 3.1 เพิ่ม migration `usage_day (agent_id, day, tokens, PRIMARY KEY (agent_id, day))` และคอลัมน์ `machine.usage_fetched_at` พร้อม `entities/usage` ที่มี `saveUsageHistory` (upsert ตามคำตอบของ Machine และลบแถวเก่ากว่า 30 วันของ Agent บนเครื่องนั้น) กับ `saveUsageFetchedAt` และ query สำหรับหน้า ตรวจด้วย test บน `bun:sqlite` เรื่อง upsert ทับยอดเดิม, prune, เวลาที่ได้ล่าสุดต่อ Machine

- [x] 3.2 ให้ `features/machine-link` มี `requestUsage(machine, days)` ที่สร้าง `request` ด้วย `newId`, เก็บสถานะต่อ Machine และรับ `usage.listed` เพื่อเขียนแคชก่อนแล้วเปลี่ยนสถานะเมื่อ `request` ตรงกับคำขอล่าสุด ตรวจด้วย test ใน `links.test.ts` ที่ใช้ Hub ปลอมว่า request ที่ส่งมี `type: "usage.list"` และ `days` ถูกต้อง, คำตอบเขียน `usage_day` กับ `usage_fetched_at`, คำตอบเก่าทำให้ loading ยังค้างจนคำตอบที่ตรงมา และ Hub error ของ request นี้ไม่ไปแตะ pending message

## 4. Controller UI

- [x] 4.1 เพิ่มไอคอน `usage` (`chart.bar` / `bar_chart`) ใน `shared/ui/icon.tsx`, route `controller/app/usage.tsx`, แถว "การใช้ token" ในหน้า Workspace และคำใน `pages/workspace/i18n` ทั้งสองภาษา

- [x] 4.2 เพิ่มหน้า `pages/usage` ที่เลือกช่วง 1, 3, 7, 30 วัน (ค่าเริ่มต้น 7 และจดจำใน `device_setting` key `usage.window`), ขอ `usage.list` จากทุก Machine ที่มี Agent เมื่อเปิดและเมื่อเปลี่ยนช่วง, จัดกลุ่มตาม Machine แล้ว Agent, แสดงยอดรวมที่ใช้ไปของ Machine โดยไม่มีตัวหาร Budget, แตะแถว Agent ไปหน้าของ Agent และมีสถานะกำลังโหลด/ว่าง/ผิดพลาด

- [x] 4.3 เพิ่มกราฟแท่งต่อวันเป็น shared component ใน `shared/ui` ที่วาดด้วย `View` รับค่าสัดส่วนและข้อความให้ screen reader, วันที่ไม่มีข้อมูลเป็นร่องว่างไม่ใช่แท่งศูนย์ และใช้สีจาก theme เท่านั้น ตรวจด้วย test ของตัวจัดสัดส่วนและดูด้วยตาบน iOS Simulator แล้ว (แท่งบาง 24pt ไม่กลายเป็นบล็อกในมุมมอง 7 วัน)

- [x] 4.4 เพิ่มรายการ "งานที่ใช้ token มากที่สุด" 10 อันพร้อมชื่อ Agent และตัวอย่างข้อความของ Task จากตาราง `task` (ไม่รู้จักแสดงรหัส 8 ตัวแรก) และแถว "อื่น ๆ" จากผลต่างเมื่อคำตอบมี Task ครบ 20 อัน

- [x] 4.5 เพิ่มคำของ `usage.invalid_range` ใน `shared/i18n/errors` ทั้งสองภาษา และคำทุกคำของหน้าใน `pages/usage/i18n` ทั้งสองภาษา ตรวจด้วย `bun scripts/check-i18n.ts`

## 5. ปิดงาน

- [x] 5.1 เพิ่ม e2e ที่ตั้ง Budget แล้วคุยสอง Task กับ Provider ปลอม ขอ `usage.list` ด้วย `days: 1` แล้วตรวจยอดแยก Task, ผลรวม และ `request` ที่สะท้อนกลับมา จากนั้นขอ `days: 7` แล้วตรวจ `from`/`to` ตามวันของ Machine

- [x] 5.2 เขียน `manual-checks.md` ให้เจ้าของลองกับ Provider จริงบน iPhone และเว็บ เรื่องกราฟ 1/3/7/30, วันที่ไม่มีข้อมูล, ออฟไลน์แล้วเห็นแคชพร้อมเวลา, Machine คนละเขตเวลา และการไม่เห็น Agent ที่ไม่มี Manage (AGENTS.md ไม่ต้องแก้เพราะไม่มีคำสั่งหรือไฟล์ที่ต้องบอกใหม่)

- [x] 5.3 ตรวจว่า dependency-cruiser ยังผ่าน (module `supervisor/usage/` ไม่ใช่ slice) และ `bun run check` กับ `bun run test` ผ่านทั้งหมด
