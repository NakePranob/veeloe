## 1. Model

- [x] 1.1 เปลี่ยน `ToolCall` ใน `pages/task/model/items.ts` เป็น `{ id, tool, target, state, output?, error? }` โดยอ่าน `target` จาก input ของแต่ละ tool ทั้งแปดชนิด และ tool ที่ไม่รู้จักใช้ชื่อ tool; ตรวจด้วย test ใน `items.test.ts` หนึ่งกรณีต่อชนิดและหนึ่งกรณี tool ที่ไม่รู้จัก
- [x] 1.2 เพิ่ม `summaryOf(calls)` ตามตารางใน design.md ข้อ 2 (running ก่อน, แล้ว failed ล่าสุดพร้อมบรรทัด error, แล้วตัวสุดท้าย, จำนวนที่ซ่อน, มี failed ซ่อนอยู่ไหม); ตรวจด้วย test ครบทุกแถวของตาราง
- [x] 1.3 ให้ `items()` สร้าง Item `{ kind: "changes", files }` ตอน `turn.ended` จาก `edit` และ `write` ที่สำเร็จใน Turn นั้น ไม่ซ้ำและเรียงตามครั้งแรก; ตรวจด้วย test สามกรณีใน spec (สองไฟล์, แค่อ่าน, แก้ไม่สำเร็จ)
- [ ] 1.4 ย้ายการหาข้อมูลและสถานะของหน้าจาก `TaskPage.tsx` ไป `pages/task/model/screen.ts` (`agent`, `machine`, `readOnly`, `busy`, `isStopping`, Agent ที่ถูกลบ) และแยกส่วนที่เป็นกฎออกเป็นฟังก์ชันล้วน; ตรวจด้วย test ของกรณี Agent ถูกลบ และกรณี Stop ที่ Machine ปฏิเสธ

## 2. คำ

- [x] 2.1 เพิ่มคำกริยาของ tool ทั้งแปดชนิด, `tools.other`, จำนวนที่ซ่อน, และแถวสรุปไฟล์ ใน `pages/task/i18n/th.json` และ `en.json` โดยใช้ตัวแปรไม่ต่อประโยค; ตรวจด้วย `bun run check` (ตัวตรวจ key ไทยกับอังกฤษ)

## 3. UI

- [x] 3.1 แยก `TaskPage.tsx` เป็นไฟล์ตามโครงใน design.md ข้อ 4 โดยไม่เปลี่ยนพฤติกรรม; ตรวจด้วย `bun run test` และส่งข้อความ หยุด แนบไฟล์ และตอบ Approval ผ่าน `bun run dev:ios` ได้เหมือนก่อนแยก (แยกแล้วด้วยชื่อไฟล์ต่างจาก design.md ข้อ 4: `AgentText`/`PendingBubble` แทน `Message`, `ToolCalls` รวม `ToolGroup` กับแถวสรุปไฟล์, `LogCards` แทน `cards/*`, `TaskTitle` สำหรับ header)
- [x] 3.2 ทำ `ToolGroup` แบบหุบเป็นค่าเริ่มต้นตาม `summaryOf` และเปิดดูทุก call ได้ ตามแบบ `Chat-Tools` และ `Chat-Working` บน canvas; ตรวจบน iOS Simulator ว่าทุก scenario ของ requirement "หน้า Task แสดงคำสั่งที่ Agent รัน" ตรงกับที่เห็น
- [x] 3.3 ทำ `ChangesRow` ตามแบบบน canvas; ตรวจโดยให้ Agent แก้สองไฟล์ผ่าน `bun run dev:ios` แล้วเห็นแถว "แก้ 2 ไฟล์" ที่กดเปิดได้ (อยู่ใน `ToolCalls.tsx`)
- [x] 3.4 ย้าย Character ไป header ด้วย `Stack.Screen options.headerTitle` ขนาด 36 ซ้ายชื่อ พร้อมสถานะใต้ชื่อ และแตะแล้วเปิดหน้า Agent; ตรวจบน iOS Simulator และ web
- [x] 3.5 ปรับ Message (bubble สีหมึกของ Owner, ข้อความ Agent ไม่มี bubble, ข้อความรอคิว, บรรทัดเหตุการณ์), ApprovalCard (สีของ Agent และ Character ลอย) และ Composer (ช่องลอย ส่ง/หยุด) ตามแถวแชตบน canvas; ตรวจโดยเทียบทุกบอร์ด `Chat-*`, `B3-Talk` และ `B3-Task` กับ iOS Simulator
- [x] 3.6 ลบ `useColors()` และ hex ออกจาก `pages/task/ui` และลบข้อยกเว้นของ `pages/task/ui` ใน `.conventions/rules.json`; ตรวจด้วย `bun run check:structure`
- [x] 3.7 แก้ป้ายบนกระดาน Design system จาก "ย้ายเป็น widget" เป็น "อยู่ใน pages/task" ให้ตรงกับ design.md ข้อ 4; ตรวจโดยเปิดกระดาน

## 4. ตรวจ

- [ ] 4.1 `bun run check`, `bun run test` และ `bun run test:e2e` ผ่าน
- [ ] 4.2 เปิดหน้า Task บน iOS Simulator และ web ทั้งสองโหมดและสองภาษา ครบทุกเหตุการณ์ในแถวแชตของ canvas พร้อมภาพหน้าจอใน PR
