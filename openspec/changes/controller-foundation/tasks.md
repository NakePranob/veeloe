## 1. โครงแอป

- [x] 1.1 สร้าง `controller/` ด้วย Expo SDK 58, Expo Router (root `./app`) และชั้น FSD ใน `src/` พร้อม `theme`, `Text`, `Button`, `Card`, `Icon` และหน้าแรกที่ยังว่าง ตรวจว่า `expo run:ios` กับ `expo start --web` เปิดหน้าแรกได้
- [x] 1.2 เพิ่ม `controller` เข้า workspace, `typecheck`, `test`, Steiger ใน `check` และขั้นตอนใน CI ตรวจว่า `bun run check` กับ `bun run test` ที่ root ครอบ `controller/` และ import ข้ามชั้นที่ใส่ทดลองทำให้ Steiger ล้ม

## 2. ข้อความ

- [x] 2.1 เพิ่ม `shared/i18n` ด้วย i18next, `useT` และการเลือกภาษาจากเครื่อง ตรวจด้วย test ว่าเครื่องภาษาไทยได้ไทย ภาษาที่ไม่รองรับได้อังกฤษ และ key ที่ขาดได้อังกฤษ และตรวจรูปพหูพจน์ในแอป iOS จริง ถ้า Hermes ไม่มี `Intl.PluralRules` ให้เพิ่ม polyfill
- [x] 2.2 รวม resource จาก slice ใน `src/app` พร้อม type จาก `en.json` ตรวจว่า `tsc` ล้มเมื่อเรียก key ที่ไม่มี
- [x] 2.3 เขียน `scripts/check-i18n.ts` และเพิ่มเข้า `check` ตรวจด้วย test เรื่องคำขาด, ไฟล์หาย, ตัวแปรไม่ตรง และรูปพหูพจน์ที่ต่างกันต้องผ่าน
- [x] 2.4 เพิ่ม `describeError` กับ namespace `errors` ครบ `hub.machine_offline`, `hub.sender_mismatch` และ `hub.route_not_allowed` ตรวจด้วย test เรื่อง code ที่รู้จักและ code ที่ไม่รู้จักทั้งสองภาษา

## 3. ข้อมูลบนเครื่อง

- [x] 3.1 เพิ่ม `shared/db` ที่มีคิวเดียว, migration และ `write(topics, fn)` ตรวจด้วย test บน `bun:sqlite` เรื่องลำดับ migration, migration ที่ล้มไม่ขยับรุ่น, แจ้งครั้งเดียวต่อ commit, ไม่แจ้งเมื่อ rollback, topic ที่ไม่เกี่ยวไม่ถูกแจ้ง และการอ่านไม่เห็นแถวที่ยังไม่ commit
- [x] 3.2 เพิ่ม `useLiveQuery` และเก็บภาษาใน `device_setting` พร้อมหน้าตั้งค่าภาษา ตรวจบน iOS และเว็บว่าเปลี่ยนแล้วมีผลทันที และยังอยู่หลังเปิดใหม่
- [ ] 3.3 ตั้ง Metro ให้รู้จัก `.wasm` และเรียก `storage.persist()` ตรวจบน `expo export -p web` ที่เสิร์ฟโดยไม่มี COOP/COEP ใน Chromium กับ WebKit และ Firefox จากผลที่เจ้าของลองตาม `manual-checks.md`
- [x] 3.5 แก้ ADR 0021 และเพิ่มหน้า `storage-unavailable` ทั้งสองภาษา ตรวจใน WebKit แบบไม่เก็บข้อมูลว่าเห็นหน้านี้ไม่ใช่หน้าขาว และกดลองใหม่แล้วกลับมาหน้าเดิม ตรวจบน iOS ด้วยความล้มเหลวชั่วคราวที่ไม่ commit ว่าลองใหม่แล้วเข้าแอปได้
- [x] 3.4 เพิ่มตัวถือแท็บบนเว็บและหน้า "ใช้ที่นี่" ทั้งสองภาษา ตรวจในเบราว์เซอร์จริงเรื่องเปิดแท็บที่สอง, ย้ายแท็บ และปิดแท็บที่ถืออยู่

## 4. ปิดงาน

- [x] 4.1 ลองบน iOS Simulator และเว็บ ทั้งสว่างและมืด ทั้งไทยและอังกฤษ พร้อมภาพหน้าจอของทุกหน้า และตรวจว่าข้อความไม่ล้นทั้งสองภาษา
- [ ] 4.2 เจ้าของลองตาม `manual-checks.md` ใน Safari และ Firefox จริง แล้วรายงานผล ตรวจว่าทุกข้อผ่าน หรือมีการตัดสินแล้วว่าข้ามข้อไหน
- [x] 4.3 เพิ่ม `controller/AGENTS.md` กับ `CLAUDE.md` และแก้ `AGENTS.md` ที่ root เรื่อง Controller กับการตรวจ ตรวจโดยอ่านเทียบกับ `package.json` และ CI
