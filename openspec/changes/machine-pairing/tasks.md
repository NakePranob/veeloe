## 1. กู้ Runtime

- [x] 1.1 กู้ `packages/runtime` จาก `33deb1a~1` เพิ่มเข้า `test` และเพิ่ม dependency-cruiser ใน `check` ตรวจว่า test ของ config, กุญแจ และ hub-link ผ่าน และ import จาก supervisor ไป worker ที่ใส่ทดลองทำให้ `check` ล้ม

## 2. Protocol

- [x] 2.1 เพิ่ม `parsePairingLink`, `buildPairingLink` และลายเซ็นของลิงก์ พร้อม vector ตรวจด้วย test เรื่องค่าถูกแก้ หมดอายุ และรูปแบบผิด
- [x] 2.2 เพิ่ม `pairing.claim`, `pairing.done` และ `pairingProof` พร้อม vector ตรวจด้วย test ว่าค่าพิสูจน์เปลี่ยนเมื่อกุญแจหรือ Member เปลี่ยน และ build ไม่ต้องใช้รหัสลับใน payload

## 3. Hub

- [x] 3.1 เพิ่ม migration ของ `workspace_svc.workspaces` พร้อม foreign key และ module `pairing` ตรวจด้วย `go-scaffold check` และ `migrate-verify`
- [x] 3.2 เพิ่ม `POST /pairings` พร้อม CORS ตรวจด้วย test บน Postgres เรื่อง Controller ตัวแรก, Machine เครื่องที่สอง, คำขอซ้ำ, ลายเซ็นผิดทั้งสองฝั่ง, หมดอายุ และ `hub.machine_taken` ที่ไม่ทิ้ง Workspace ค้าง
- [x] 3.3 แก้ ADR 0014 และเพิ่ม code ใหม่ใน `errors` ของ Controller ตรวจด้วย test ของ i18n

## 4. Runtime

- [x] 4.1 เพิ่ม `trust.json` กับ `seen.json` ตรวจด้วย test เรื่องสิทธิ์ 0600, เขียนไม่ครึ่งไฟล์ และเลขลำดับอยู่รอดข้ามการเริ่มใหม่
- [x] 4.2 เพิ่ม `veeloe pair` ตรวจด้วย test ที่ใช้ Hub ปลอมเรื่อง claim ถูกต้อง, ค่าพิสูจน์ผิด, Hub สลับกุญแจ, ซองชนิดอื่น, หมดเวลา และเครื่องที่ Pairing แล้ว
- [x] 4.3 เพิ่ม `veeloe unpair` และให้ `veeloe` ตรวจซองกับกุญแจที่ไว้ใจ ตรวจด้วย test เรื่องไม่ยืนยันแล้วไม่ลบ, กุญแจไม่รู้จักถูกทิ้ง และซองเก่าถูกทิ้งหลังเริ่มใหม่

## 5. Controller

- [x] 5.1 เพิ่ม `shared/hub-client` กับ `seq` จากนาฬิกา ตรวจด้วย test เรื่องเลขเดินหน้าเมื่อนาฬิกาถอยหรือส่งรัว และตรวจกับ `testhub` ว่าแลกซองที่ `verify` ยอมรับได้
- [x] 5.2 เพิ่ม `entities/machine` กับ migration ตรวจด้วย test บน `bun:sqlite`
- [x] 5.3 เพิ่มขั้นตอน Pairing ใน `pages/add-machine` ตรวจด้วย test ที่ใช้ Hub ปลอมเรื่องยกเลิกการยืนยันตัวแล้วไม่ส่งอะไร, ลองใหม่เมื่อ `hub.machine_offline`, `pairing.done` จากกุญแจอื่น และหมดเวลา
- [x] 5.4 เพิ่มหน้าเพิ่ม Machine ที่สแกนและวางลิงก์ได้ ทั้งสองภาษา และแสดง Machine บนหน้าแรก ตรวจบน iOS Simulator และเว็บด้วยการวางลิงก์ ทั้งสว่างและมืด

## 6. ปิดงาน

- [x] 6.1 เพิ่ม e2e ที่รัน `cmd/api`, Postgres และ `veeloe pair` จริง พร้อม service ใน CI ตรวจว่า Machine ได้กุญแจที่ถูกต้องและ Hub ยอมรับทั้งสองฝั่ง
- [x] 6.2 เขียน `manual-checks.md` ให้เจ้าของลองสแกน QR จาก terminal ด้วยกล้องบน iPhone จริงกับ Runtime จริง และแก้ `AGENTS.md` เรื่อง Runtime กับการตรวจ
