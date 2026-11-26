## 1. Package และเครื่องมือ

- [x] 1.1 กู้ `packages/protocol` จาก `33deb1a^` โดยไม่เอาข้อความ `hub-*`, `frame.ts` และ vector ของ handshake เพิ่ม `packages/*` ใน workspace ที่ root และตรวจว่า `bun install` สำเร็จ และ `bun.lock` บันทึก `@noble/curves` 2.4.0 กับ `zod` 4.6.7
- [x] 1.2 เพิ่ม test ของ package ใน `bun run test` และ source ใน `bun run typecheck` และตรวจว่าทั้งสองรัน test ของ Protocol
- [x] 1.3 ตรวจว่า test ของ crypto และ base64url ที่กู้มาผ่านโดยไม่แก้

## 2. เส้นทาง

- [x] 2.1 เพิ่ม `recipients` ในหัวซองและส่วนที่เซ็น และบังคับให้มี `to` หรือ `recipients` อย่างใดอย่างหนึ่ง พร้อม test ว่ามีทั้งคู่หรือไม่มีเลยเป็น `malformed`
- [x] 2.2 เทียบ `recipients` กับสำเนาที่เซ็นทีละตัว และตรวจด้วย test ว่าสมาชิกที่เปลี่ยนและลำดับที่เปลี่ยนเป็น `header-mismatch` ทั้งคู่
- [x] 2.3 ให้ตัวเซ็นรับเส้นทางแบบใดก็ได้ และตรวจด้วย test ว่า field เส้นทางที่ไม่มีไม่อยู่ทั้งในหัวซองและส่วนที่เซ็น

## 3. การตรวจของผู้รับ

- [x] 3.1 เพิ่ม predicate `isForMe` และการปฏิเสธ `not-addressed` ต่อจากการตรวจสำเนาหัวซอง และตรวจด้วย test เรื่องปลายทางผิดและรายชื่อผู้รับที่ไม่มี Member
- [x] 3.2 ตรวจด้วย test ว่าเหตุผลการปฏิเสธทุกแบบไม่ขยับตัวนับ รวมถึง `not-addressed`
- [x] 3.3 ตรวจว่า test ที่กู้มาเรื่อง byte ตรงตัว การตรวจก่อน parse การส่งซ้ำ เลขข้าม และ field ที่ไม่รู้จัก ผ่านกับ `verify` รูปแบบใหม่

## 4. ข้อความ

- [x] 4.1 เพิ่ม `messages/error.ts` พร้อมรูปแบบ code และรูปร่าง `params` และตรวจด้วย test เรื่อง code ที่รู้จัก code ที่ไม่คุ้น ไม่มี code ใช้ประโยคเป็น code และค่าประกอบซ้อนกัน
- [x] 4.2 เพิ่ม `parseMessage` ที่คืน `message`, `unknown` หรือ `invalid` และตรวจด้วย test ว่าชนิดที่ไม่รู้จักและ `error` ที่ไม่ถูกต้องคืนค่าโดยไม่ throw

## 5. ไฟล์ที่เผยแพร่

- [x] 5.1 เพิ่มกรณีใน vector เรื่องเส้นทาง `recipients`, `not-addressed`, มีทั้งสองเส้นทาง และไม่มีเส้นทาง สร้าง schema กับ vector ใหม่ และตรวจว่า test ล้มเหลวเมื่อไฟล์ใดต่างจากที่โค้ดสร้าง
- [x] 5.2 ตรวจด้วย test ว่า vector ครอบเหตุผลการปฏิเสธทุกแบบ และชุดที่คาดไว้มี `malformed` กับ `not-addressed`

## 6. ปิดงาน

- [x] 6.1 เพิ่ม test ของ Protocol ใน job ของ CI ที่ `.github/workflows/ci.yml` และตรวจว่า `bun run check` กับ `bun run test` ผ่านในเครื่องด้วยคำสั่งเดียวกับ CI
- [x] 6.2 แก้ `AGENTS.md` ตรงที่บอกว่า Protocol ยังไม่มีโค้ดและตรงที่บอกว่า `check` กับ `test` ครอบอะไร และตรวจโดยอ่านเทียบกับ `package.json` ที่ root
- [x] 6.3 รัน `openspec validate protocol-envelope --strict` และตรวจว่าผ่าน
