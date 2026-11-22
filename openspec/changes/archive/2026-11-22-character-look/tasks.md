## 1. Look

- [x] 1.1 ใน `entities/character/model/look.ts` แยก `DEFAULT_COLOR = "#F4B183"` ออกจาก `COLORS` และเปลี่ยน `COLORS` เป็นชุดใหม่แปดสี พร้อมชื่อสีสำหรับคำบอก; ตรวจด้วย test ใน `character.test.ts` ว่า `lookOf(null)` ยังได้ `#F4B183` และ `lookOf({ color: "#F4B183" })` คงสีเดิม
- [x] 1.2 เพิ่ม `round` ใน `SHELLS` ไว้ท้ายสุด เพื่อให้ค่าที่ไม่รู้จักยังตกไปที่ `box`; ตรวจด้วย test ว่า `lookOf({ shell: "round" })` ได้ `round` และ `lookOf({ shell: "x" })` ได้ `box`
- [x] 1.3 เพิ่ม `tint(hex, amount)` ใน `entities/character` สำหรับพื้นสีอ่อนของฉากและช่องเลือก; ตรวจด้วย test ว่า `tint("#C4B1FF", 1)` ได้ขาว และ `tint(x, 0)` ได้สีเดิม

## 2. Mood

- [x] 2.1 เพิ่ม `failed` และ `stuck` ใน type `Mood` และให้ `moodOf()` คืน `failed` เมื่อ `turn.ended` มี `reason: "error"` ส่วน `stopped` กับ `interrupted` คืน `idle`; ตรวจด้วย test ของ `moodOf` ครบทุกแถวในตารางของ design.md ข้อ 2
- [x] 2.2 ไล่ทุกที่ที่ใช้ `Mood` (Inbox, หัว Task, หน้า Agent) ให้รองรับ `failed` และ `stuck` โดยไม่มี `switch` ที่ตกหล่น; ตรวจด้วย `bun run check` ที่ type ล้มเมื่อขาดกรณี

## 3. Character

- [x] 3.1 วาดเปลือก `round` ใน `Character.tsx` ตาม design.md ข้อ 3; ตรวจโดยดูบน iOS Simulator และ web ว่าทรงกลมมีผนังด้านข้าง จอพอดี และทุกชิ้นส่วนเกาะตำแหน่งถูก เทียบกับแผ่น Character บน canvas
- [x] 3.2 วาดท่า `failed` (ตาไขว้ จอแดงอ่อน หัวเอียงนิ่ง) และ `stuck` (ตาค้าง สั่นห่างๆ) และให้ทั้งสองหยุดนิ่งเมื่อลดการเคลื่อนไหว; ตรวจโดยเปิด Reduce Motion บน iOS Simulator และเทียบภาพกับแผ่น Character
- [x] 3.3 ให้ `failed` ไม่เล่นการกระโดดเมื่อ Mood เปลี่ยน; ตรวจโดยจำลอง Turn ที่จบด้วย error ผ่าน `bun run dev:ios` แล้ว Character ไม่กระโดด

## 4. หน้าแก้ Character และหน้าสร้าง Agent

- [x] 4.1 ย้ายแผนที่สีจาก `pages/agent-character` ไปใช้ `COLORS` กับชื่อสีจาก `entities/character` และลบข้อยกเว้น hex ของหน้านี้ออกจาก `.conventions/rules.json`; ตรวจด้วย `bun run check:structure` และ `grep -nE '"#[0-9A-Fa-f]{6}"' controller/src/pages` ไม่เจออะไร
- [x] 4.2 ทำหน้าแก้ Character ตามแผ่นบน canvas: ฉาก `tint` ของสี, หัวใหญ่, การ์ดท่าที่กดดูได้, ปุ่มสุ่มแบบ `Button floating`, แถวสี และช่องเลือกที่ไม่มีกรอบ; ตรวจบน iOS Simulator และ web ทั้งสองโหมดและสองภาษาเทียบกับกระดาน
- [x] 4.3 ให้หน้าแก้ Character ไม่เลือกวงสีใดเมื่อสีของ Agent ไม่อยู่ในชุด; ตรวจโดยใช้ `bun run dev:seed` กับ Agent ที่สีเดิม แล้วไม่มีวงไหนถูกเลือก
- [x] 4.4 ให้ปุ่มสุ่มในหน้าสร้าง Agent สุ่มจากชุดสีใหม่และเปลือกทั้งห้า โดยยังไม่ซ้ำกับ Agent อื่น; ตรวจด้วย test ของฟังก์ชันสุ่มที่มีอยู่

## 5. ตรวจ

- [x] 5.1 `bun run check` และ `bun run test` ผ่าน
- [x] 5.2 Agent ที่สร้างก่อน change นี้หน้าตาเหมือนเดิมใน Inbox หลังอัปเดต; ตรวจด้วย `bun run dev:seed` ก่อนและหลังพร้อมภาพหน้าจอใน PR
