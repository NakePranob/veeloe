# ขนาดตัวอักษร ลิงก์ cast และคำของ Controller มีตัวตรวจ

Status: accepted

เพิ่มเติม ADR 0065, ADR 0070 และ ADR 0072 (กฎสี่ข้อใหม่ใน `controller/.conventions/rules.json`)

`controller/AGENTS.md` เขียนไว้แล้วว่าตัวอักษรมาจาก `shared/ui` ทุกตัวควบคุมมี pressed state กับเป้า 44pt และคำมาจาก i18n ของ slice แต่การไล่ดูโค้ดรอบนี้เจอ `fontSize` เขียนตัวเลขเองในหน้า 28 ที่ `Text` ที่ใส่ `onPress` แทนลิงก์ ซึ่งไม่มี pressed state และเป้าเล็กกว่า 44pt, `as never` ที่บังชนิดของ route และของ key i18n จน key ผิดก็ผ่าน type check และคำที่เขียนลงโค้ดตรงๆ ทั้งหมดแก้ได้ แต่ถ้ามีแค่ร้อยแก้ว ก็จะกลับมาอีก เหมือนสีก่อน ADR 0072

**การตัดสินใจ:**

- **`type-from-shared-ui`: ไฟล์ใน `src/pages` และ `src/widgets` ไม่ตั้ง `fontSize`, `fontFamily`, `fontWeight`, `letterSpacing` หรือ `lineHeight`** ขนาดและน้ำหนักมาจาก `variant` ของ `Text` และ token `type` ใน `shared/ui/theme.ts` รอบนี้เพิ่ม `prose` (ข้อความที่ Agent เขียน อ่านยาว ระยะบรรทัด 26) และ `rowTitle` (ชื่อ Agent ในแถว Inbox ตัวหนา) แทนค่าที่หน้าตั้งเอง ส่วน Memory ใช้ระยะบรรทัดของ `footnote` ตามเดิม
- **`links-are-pressables`: ไฟล์ใน `src/pages` และ `src/widgets` ไม่ใส่ `onPress` บน `<Text`** ลิงก์หรือการกระทำใช้ `TextLink`, `Button` หรือ `Row` ซึ่งมี pressed state, role และเป้า 44pt ข้อยกเว้นเดียวคือ `pages/task/ui/AgentText.tsx`: ลิงก์ใน Markdown ของ Agent อยู่กลางประโยค มีแต่ `Text` ซ้อนที่ทำให้บรรทัดไหลต่อได้ `Pressable` จะตัดย่อหน้าออกเป็นท่อน
- **`no-blind-casts`: ไฟล์ใน `src` (ยกเว้น test) ไม่มี `as never` หรือ `as unknown as`** ชื่อชิ้นของ Character อ่านจาก object ของ `parts` ทั้งก้อน (`returnObjects`) แทนการต่อ key แล้ว cast และ polyfill ของ `crypto` ประกาศชนิดตอนกำหนดค่าแทน ข้อยกเว้นเดียวคือ `shared/i18n/errors/describe-error.ts`: code จาก Runtime หรือ Hub เป็น string ที่คำศัพท์โตขึ้นเรื่อยๆ (ADR 0023) และ `i18n.exists` ตรวจ key ในบรรทัดก่อนหน้าแล้ว จุดที่ cast จึงเป็นจุดที่ตรวจ
- **`words-from-i18n`: ไฟล์ `.ts`/`.tsx` ใน `src` (ยกเว้น test) ไม่มีอักษรไทย (U+0E00–U+0E7F) นอก comment** comment ยกคำบนกระดานมาอ้างได้ test ใช้ภาษาไทยทดสอบการตัดคำและพหูพจน์ได้ คำภาษาอังกฤษที่เขียนลงโค้ดตรงๆ แยกจากชื่อ key, route หรือค่าอื่นไม่ได้อย่างน่าเชื่อถือ จึงไม่ตรวจ ยังเป็นงานของการ review
- **`check-i18n` ล้มเมื่อมี key ที่ไม่มีโค้ดไหนอ่าน** key ถูกอ่านเมื่อมี string ในโค้ดของ slice (หรือไฟล์ที่เปิด `useT("<namespace>")` ของมัน) ตรงกับ key หรือ object ที่อยู่เหนือมัน, เมื่อต้น template ตรงกับมัน (`` t(`moods.${mood}`) `` อ่าน `moods.*` ทั้งหมด) หรือเมื่อ string ลงท้ายด้วยจุด รูปพหูพจน์ `_one`/`_other` นับเป็น key ฐาน คำของ `errors` ไม่ตรวจ เพราะ key คือ code ที่ Runtime และ Hub ส่งมา

กฎสี่ข้อนี้อยู่ใน `controller/.conventions/rules.json` ตรวจโดย `controller/scripts/check-structure.ts` ส่วน key ที่ไม่ถูกอ่านตรวจโดย `controller/scripts/check-i18n.ts` ตัวตรวจตัด comment ออกก่อนดู จึงไม่ล้มเพราะ comment ที่เอ่ยถึงชื่อ style หรือยกคำไทย

## Considered Options

- **parse JSX ด้วย TypeScript compiler:** แม่นกว่า regex เรื่อง `<Text` ที่มี `onPress` และ string ที่มี `//` แต่ตัวตรวจจะใหญ่กว่าปัญหา regex พลาดได้แค่ทางที่ไม่จับ ไม่เคยล้มผิด
- **ห้าม import `font` และ `type` ในหน้า:** จับได้กว้างกว่า แต่ `TextLink` และแถวที่คำนวณ hitSlop จาก `type[...].lineHeight` อยู่ใน `shared/ui` อยู่แล้ว การห้าม prop ห้าตัวตรงกับสิ่งที่หน้าเขียนเองจริง
- **นับ key i18n ว่าถูกอ่านเฉพาะเมื่อเป็นอาร์กิวเมนต์ของ `t()`:** แม่นกว่า แต่ key ที่ส่งผ่าน map หรือ prop (`WINDOW_KEY`, `OUTCOME`) จะล้มผิด จึงนับทุก string ใน slice
- **เขียนไว้ใน AGENTS.md อย่างเดียว:** เป็นสภาพก่อน ADR นี้ ซึ่งปล่อยให้เกิดทุกข้อที่ไล่เจอ

## Consequences

- ขนาดหรือน้ำหนักที่หน้าต้องการแต่ `type` ยังไม่มี เพิ่มเป็น token ใน `shared/ui/theme.ts` และวาดบนกระดาน Design system พร้อมกัน (`prose` และ `rowTitle` ยังต้องวาดบนกระดาน)
- ส่ง style ผ่านตัวแปรหรือ prop ที่ไม่ได้เขียนชื่อ prop ตรงๆ ยังเลี่ยงกฎได้ ถ้าเจอทางที่เกิดจริง ให้เพิ่มเป็นไฟล์ที่ต้องถูกปฏิเสธในกฎ
- key i18n ที่ชื่อบังเอิญตรงกับ string อื่นใน slice จะไม่ถูกจับว่าไม่ได้ใช้ ยอมรับไว้แลกกับการไม่ล้มผิด
