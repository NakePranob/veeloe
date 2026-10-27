## 1. หน้าตาของ Agent และ store

- [x] 1.1 `moodOf` คิด Mood จาก event ของ Task ตาม requirement "Mood comes from the Task's events" (ทำแล้วใน `31b8c71`) ตรวจด้วย unit test "the Character's Mood follows the events" ใน `controller/src/entities/task/model/state.test.ts` ที่ผ่าน
- [x] 1.2 รวมหน้าตาของ `Agent` เป็น `character: { color, shell, top, sides, decal }` และเพิ่มฟังก์ชันทำค่าเป็นปกติที่ถอยไปใช้ `box`, `none` และสีแรกของชุดทีละช่อง ตามข้อ 1 ใน design แล้วให้ Character, Inbox และหน้า Task อ่านผ่านก้อนนี้ ตรวจด้วย unit test ที่ครอบสอง scenario ใน requirement "Unknown look values fall back" และ `bun run check` ที่ผ่าน
- [x] 1.3 ย้าย Agent ใน Demo ไปไว้ใน store ตามข้อ 2 ใน design พร้อม `updateCharacter` ที่เปลี่ยนทั้งก้อนในครั้งเดียว ตรวจด้วย unit test ว่าหลัง update ผู้ฟังได้ค่าใหม่ Agent ตัวอื่นไม่เปลี่ยน และ store ไม่ส่งอะไรออกไปนอกเครื่อง (requirement "The Demo Workspace keeps edits on the phone")

## 2. ตรรกะของการแก้

- [x] 2.1 เขียน draft ใน `src/entities/agent/model/look.ts` เป็นฟังก์ชันล้วน (ข้อ 7 ใน design): เริ่มจากหน้าตาของ Agent, เลือกค่าในแต่ละช่อง, เสร็จ (คืนก้อนที่ส่งให้ `updateCharacter`) และยกเลิก ตามข้อ 5 ใน design ตรวจด้วย unit test ที่ครอบสาม scenario ใน requirement "Picking edits a draft until Done" ในระดับข้อมูล
- [x] 2.2 เขียนการสุ่มตามข้อ 6 ใน design โดยรับตัวสุ่มเข้ามา ตรวจด้วย unit test ที่ใช้ตัวสุ่มตายตัว ว่าได้หน้าตาที่ไม่ซ้ำกับ Agent ตัวอื่น แม้ตัวสุ่มจะให้หน้าตาที่ซ้ำออกมาก่อน (requirement "Shuffle avoids looks already in use")

## 3. หน้าแก้และทางเข้า

- [x] 3.1 เพิ่ม route `controller/app/agents/[agent]/character.tsx` ที่เป็น `formSheet` ใน Stack ของ `RootLayout` และหน้า `src/pages/agent-character` ที่มีปุ่มยกเลิกกับเสร็จใน header และกรณีไม่พบ Agent ตามข้อ 3 ใน design ตรวจด้วย `bun run check` (รวม Steiger) ที่ผ่าน และรันบน iOS Simulator กับเว็บว่า sheet เปิดและปิดได้ และ URL ของ Agent ที่ไม่มีแสดงว่าไม่พบพร้อมทางกลับ
- [x] 3.2 วางหัวใหญ่ แถวหัวขนาด Inbox ของทุก Mood และห้าหมวดตามข้อ 4 ใน design พร้อม prop ที่ทำให้หัวในตัวเลือกอยู่นิ่ง, haptic แบบ selection บน iOS และ label กับสถานะที่เลือกให้ screen reader ตาม requirement "The editor works with a screen reader" ตรวจด้วย unit test ของ draft ที่หน้านี้ใช้ และรันบน iOS Simulator กับเว็บทั้งโหมดสว่างและมืด พร้อมภาพหน้าจอของแต่ละแบบ ตามกติกาใน `controller/AGENTS.md`
- [x] 3.3 ทำให้หัวหุ่นที่หัวหน้า Task เป็นปุ่มที่เปิดหน้าแก้ของ Agent ตัวนั้น มีสถานะตอนกดและ label ว่าแก้ Character ของ Agent ตัวไหน ตรวจด้วยการรันบน iOS Simulator กับเว็บว่าแตะแล้วเปิดหน้าแก้ของ Agent ที่ถูกตัว (requirement "The Character at the top of a Task opens its editor")

## 4. Design system

- [x] 4.1 อัปเดต artifact ของ design system ของ Controller: README และ props ของ Character, widget ใหม่ของหน้าแก้พร้อม preview และ `index.d.ts` ตรวจด้วยการอ่าน artifact กลับมาแล้วเห็น widget ใหม่ และ props ใน `index.d.ts` ตรงกับโค้ด

## 5. ตรวจรวม

- [x] 5.1 ตรวจทั้งเส้นทางบน iOS Simulator และเว็บ ทั้งโหมดสว่างและมืด: เปิดจากหน้า Task แล้วเปลี่ยนสีกับชิ้นด้านบน กดเสร็จ แล้ว Inbox กับหน้า Task แสดงหน้าตาใหม่, กดยกเลิกแล้วไม่มีอะไรเปลี่ยน, ปัด sheet ลงแล้วไม่มีอะไรเปลี่ยน และสุ่มแล้วได้หน้าตาที่ไม่ซ้ำ พร้อม `bun run check` กับ `bun run test` ที่ผ่าน
