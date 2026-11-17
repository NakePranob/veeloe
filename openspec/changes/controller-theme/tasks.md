## 1. ต้นแบบ

- [ ] 1.1 วาดชุด dark บนกระดาน Design system ของ canvas redesign (พื้นจอ, การ์ด, หมึก, ตัวอักษรรอง, สีสถานะ, ของที่ลอย) และวางหน้าตัวอย่างอย่างน้อย Inbox, แชต และหน้า Agent ในโหมดมืด; ตรวจโดยเปิดกระดานและเห็นค่าสีของทั้งสองโหมดครบทุก token ที่ design.md ข้อ 1 ระบุ
- [x] 1.2 แก้ `controller/AGENTS.md` ให้ต้นแบบของหน้าจอคือกระดานบน canvas redesign แทน `controller-prototype` และให้ design system คือกระดาน Design system แทน artifact เดิม; ตรวจโดยค้นใน `controller/AGENTS.md` แล้วไม่เหลือประโยคที่ให้ตาม prototype

## 2. Token และฟอนต์

- [x] 2.1 เปลี่ยนค่าใน `src/shared/ui/theme.ts` ตามกระดาน ทั้ง light และ dark: `background` ขาว, เพิ่ม `card`, `surface` สำหรับของลอย, สีสถานะใหม่พร้อม `blue` และ `redText`, `radius` ชุดใหม่, เงาเฉพาะของลอย และ `type` ขนาดกับน้ำหนักตามกระดาน; ตรวจด้วย `bun run check` และดู iOS Simulator ทั้งสองโหมดว่าพื้นขาวกับการ์ดเทา
- [x] 2.2 ให้ `Section` และ `Card` ที่ไม่ `raised` ใช้พื้น `card` ไม่มีเงา และ `Card raised` ใช้ `surface` กับเงา; ตรวจโดยเปิดหน้า Workspace กับหน้า Agent บน iOS Simulator และ web แล้วไม่เห็นเงาใต้การ์ดหรือเส้นใดๆ
- [x] 2.3 ติดตั้ง `expo-font` กับฟอนต์ Space Grotesk, Anuphan และ JetBrains Mono เฉพาะน้ำหนักที่ design.md ข้อ 3 ระบุ ด้วย `bunx expo install`; ตรวจว่า `bun install` และ `bunx expo run:ios` build ผ่าน และจดขนาด build ก่อนกับหลังไว้ใน PR
- [ ] 2.4 โหลดฟอนต์ใน `RootLayout` และให้ splash ค้างจนโหลดเสร็จ; ตรวจโดยเปิดแอปแบบปิดเน็ตบน iOS Simulator แล้วหน้าแรกแสดงฟอนต์ของแอปทันทีโดยไม่กระพริบ
- [ ] 2.5 ให้ `Text` เลือก family ตามน้ำหนักและ `mono` และใช้ Anuphan เป็นหลักสำหรับข้อความไทยปนอังกฤษ; ตรวจบน iOS Simulator, Android และ web ทั้งภาษาไทยและอังกฤษว่าวรรณยุกต์ไม่ถูกตัดและไม่มีตัวเป็นกล่องเปล่า พร้อมภาพหน้าจอใน PR

## 3. ชิ้นใหม่ใน shared/ui

- [x] 3.1 ให้ `Row` เป็นไอคอนเปล่าสีหมึกไม่มีช่องรอง สูงอย่างน้อย 52 และกดแล้วพื้นเปลี่ยนเป็น `chipPressed`; ตรวจโดยเปิดหน้า Workspace แล้วแถวตรงกับกระดาน Workspace และ `bun run check` ผ่าน
- [ ] 3.2 เพิ่ม `Chip` (`tone` status, mono, count, choice; `selected`; `dot`) และส่งออกจาก `src/shared/ui/index.ts`; ตรวจด้วย `bun run check` และดูทุก `tone` ในหน้าตัวอย่างชั่วคราว ซึ่งลบก่อนปิด change
- [ ] 3.3 เพิ่ม `Tabs` (`items` ชื่อกับจำนวน, `value`, `onChange`) ที่มี role tab และจำนวนส้มเฉพาะแท็บที่ระบุ; ตรวจด้วย `bun run check` และ VoiceOver อ่านชื่อแท็บกับสถานะที่เลือก
- [ ] 3.4 เพิ่ม `Stat` (`value`, `unit`, `label`); ตรวจด้วย `bun run check` และดูในหน้าตัวอย่างชั่วคราว
- [ ] 3.5 เพิ่ม `Button` แบบ `destructive` และ `floating` (ไอคอนกลมดำมีเงาที่ขยับวน และหยุดนิ่งเมื่อลดการเคลื่อนไหว); ตรวจโดยเปิด Reduce Motion บน iOS Simulator แล้วปุ่มลอยอยู่นิ่ง และพื้นที่กดอย่างน้อย 44
- [ ] 3.6 เพิ่ม `action` ใน `Field` สำหรับปุ่มดำในช่องเดียวกัน; ตรวจด้วย `bun run check` และกดปุ่มในช่องบน iOS Simulator ได้โดยคีย์บอร์ดไม่ปิดก่อน
- [x] 3.7 ให้ `Meter` เปลี่ยนสีตามระดับ (ปกติดำ, เกิน 80% ส้ม, หมดแดง) และเพิ่ม test ของกฎระดับสีนี้; ตรวจด้วย `bun run test`
- [x] 3.8 วาดชิ้นใหม่ทั้งหมดบนกระดาน Design system ให้ตรงกับโค้ด (ชื่อ props และสถานะ); ตรวจโดยเทียบรายการชิ้นใน `src/shared/ui/index.ts` กับกระดาน

## 4. กฎการใช้ element

- [x] 4.1 เขียน ADR ใหม่ใน `docs/adr/`: page กับ widget ไม่ import `useColors` หรือ `useShadows` และไม่มี hex สี, `View` ใช้จัดวางเท่านั้น, entity ใช้สีได้ และเหตุผลที่ตรวจที่ import แทน style; ตรวจโดย ADR ไม่ขัดกับ ADR 0022, 0065 และ 0070
- [x] 4.2 ย้ายหน้าใน `src/pages` และ `src/widgets` ที่เรียก `useColors()` ไปใช้ `Text tone` และชิ้นใน `shared/ui` ยกเว้น `pages/task/ui` และ hex ใน `pages/agent-character`; ตรวจด้วย `grep -rl useColors controller/src/pages controller/src/widgets` แล้วเหลือแค่ข้อยกเว้นสองที่
- [x] 4.3 เพิ่มกฎใน `controller/.conventions/rules.json` พร้อมไฟล์ที่ต้องถูกปฏิเสธ (import `useColors` ใน page, hex ใน widget) และไฟล์ที่ต้องผ่าน (hex ใน entity, `View` กับ `gap`) รายชื่อข้อยกเว้นชั่วคราวสองที่พร้อมชื่อ change ที่จะลบออก และเพิ่มตัวตรวจใน `scripts/check-structure.ts`; ตรวจด้วย `bun run check:structure` และ `python3 <keel>/skills/conventions/scripts/prove.py --root controller`

## 5. ตรวจ

- [x] 5.1 `bun run check` และ `bun run test` ผ่าน
- [ ] 5.2 เปิดทุกหน้าของแอปบน iOS Simulator และ web ทั้งโหมดสว่างและมืด และทั้งภาษาไทยและอังกฤษ แล้วไม่เห็นเส้น กรอบ หรือเงาใต้การ์ด พร้อมภาพหน้าจอแนบใน PR ตาม `controller/AGENTS.md`
