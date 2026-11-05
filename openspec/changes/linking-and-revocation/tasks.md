## 1. Protocol

- [ ] 1.1 เพิ่ม `parseLinkingLink`, `buildLinkingLink` และ `linkingProof` สำหรับ `device.handoff` พร้อม vector ตรวจด้วย test เรื่องลิงก์รูปแบบผิด หมดอายุ และค่าพิสูจน์ที่เปลี่ยนเมื่อกุญแจใหม่หรือ `data` เปลี่ยน
- [ ] 1.2 เพิ่มใบรับรอง `device.link` กับ `device.revoke` (`signCertificate`, `verifyCertificate`), frame `hub.certificates`, close code 4403, ข้อความ `device.handoff`, `device.linked`, `task.list`, `task.listed` และช่อง `keys` ของ `pairing.claim` พร้อม vector ที่ Go อ่านได้ ตรวจด้วย test ว่าใบรับรองที่ถูกแก้ไม่ผ่าน และ JSON Schema ใน `fixtures` ตรงกับ Zod

## 2. Hub

- [ ] 2.1 เพิ่ม migration ของ `controller_svc.certificates` กับ `POST /links` พร้อม CORS ตรวจด้วย test บน Postgres เรื่อง Link สำเร็จ, คนเซ็นไม่ได้ลงทะเบียน, Member หรือ Workspace อื่น, กุญแจมีเจ้าของแล้ว, กุญแจที่เคยถูกถอน และส่งใบเดิมซ้ำ
- [ ] 2.2 เพิ่ม `POST /revocations` ที่ลบกุญแจกับกุญแจที่หลุดตาม ปิดสายด้วย 4403 และปฏิเสธเครื่องสุดท้าย ตรวจด้วย test บน Postgres เรื่องสายที่ต่ออยู่ถูกปิด, handshake หลังถอนได้ 4401, `keep` และ `hub.last_device`
- [ ] 2.3 ส่ง `hub.certificates` หลัง `hub.ready` และส่งใบใหม่ให้สายที่ต่ออยู่ แล้วแก้ route ให้ Controller ส่ง `recipients` ที่มีแค่ Member ของตัวเองได้ ตรวจด้วย `go test -race` เรื่องใบรับรองมาก่อนซองแรก, Controller ส่งถึง Member อื่นได้ `hub.route_not_allowed` และไม่ส่งกลับสายที่ส่งมา เพิ่ม code ใหม่ใน `errors` ของ Controller ตรวจด้วย test ของ i18n

## 3. Runtime

- [ ] 3.1 เพิ่ม `links` กับ `revoked` ใน `trust.json` และใช้ `device.link` จาก `hub.certificates` ตรวจด้วย test เรื่องไฟล์เดิมอ่านได้, คนเซ็นที่ไม่เชื่อ, Member อื่น, Workspace อื่น, กุญแจในรายชื่อห้าม และใบเดิมซ้ำได้ผลเดิม
- [ ] 3.2 ใช้ `device.revoke` ตรวจด้วย test เรื่องเลิกเชื่อกุญแจกับกุญแจที่หลุดตาม, `keep`, ใบ `device.link` ลงเวลาย้อนหลังจากกุญแจที่ถอน, ไม่ทำตามเมื่อไม่เหลือกุญแจ, รายชื่อห้ามอยู่รอดข้ามการเริ่มใหม่ และซองจากกุญแจที่ถอนถูกทิ้ง
- [ ] 3.3 ให้ `pairing.claim` เชื่อกุญแจใน `keys` และตอบ `task.list` ด้วย Task ที่ Member เปิดดูได้ ตรวจด้วย test เรื่อง Pair จากเครื่องที่ Link มาแล้วเครื่องแรกสั่งได้ และรายการไม่มี Task ที่ Member ผู้ขอเปิดดูไม่ได้

## 4. Controller

- [ ] 4.1 เพิ่ม `entities/device` กับ migration ที่สร้างจาก `hub.certificates` หลังตรวจลายเซ็น และส่ง `task.list` ตอนต่อเข้ามา ตรวจด้วย test บน `bun:sqlite` เรื่องเครื่องแรก, Link โดยใคร, ถูกถอน, ใบที่ลายเซ็นผิดถูกทิ้ง และ Task จาก `task.listed` ถูกเพิ่มโดยไม่ทับแถวเดิม
- [ ] 4.2 เพิ่ม `pages/link-this-device` บนเครื่องใหม่ (ช่อง Hub, QR, ลิงก์ที่คัดลอกได้, รอ handoff) และปุ่มบนหน้าแรกที่ว่าง ตรวจด้วย test ที่ใช้ Hub ปลอมเรื่อง handoff ถูกต้องแล้วบันทึก Machine, ค่าพิสูจน์ผิด, handoff จากซองชนิดอื่น และหมดเวลา
- [ ] 4.3 ย้ายตัวสแกนไป `shared/ui`, รับ `veeloe://link` ใน `+native-intent.tsx` และเพิ่ม `pages/link-device` บนเครื่องเดิม ตรวจด้วย test ที่ใช้ Hub ปลอมเรื่อง Hub ไม่ตรง, ชื่อซ้ำ, ยกเลิกการยืนยันตัวแล้วไม่ส่งอะไร, ส่ง handoff ซ้ำจนได้ `device.linked` และหมดเวลา
- [ ] 4.4 เพิ่ม `pages/devices` กับแถวใน Workspace, คำเตือนเครื่องเดียว, alert เมื่อมีการ Link จากเครื่องอื่น และการถอนพร้อม `keep` ตรวจด้วย test เรื่องเครื่องสุดท้ายไม่เซ็น, ยกเลิกการยืนยันตัว และเครื่องที่ได้ 4403 หรือถอนตัวเองลบกุญแจกับฐานข้อมูลแล้วกลับหน้าสร้างกุญแจ
- [ ] 4.5 ลองทุกหน้าบน iOS Simulator และเว็บ ทั้งสว่างและมืด ทั้งไทยและอังกฤษ โดย Link เว็บจาก Simulator ด้วยการวางลิงก์ แล้วถอนเว็บจาก Simulator พร้อมภาพหน้าจอ

## 5. ปิดงาน

- [ ] 5.1 เพิ่ม e2e ที่รัน `cmd/api`, Postgres และ `veeloe` จริง ตรวจว่า Controller ตัวที่สองที่ Link แล้วสั่ง Machine ได้, Machine ที่ปิดอยู่ตอน Link และตอนถอนได้ใบรับรองตอนต่อเข้ามา และกุญแจที่ถอนแล้วถูกปฏิเสธทั้งที่ Hub และ Runtime
- [ ] 5.2 แก้ `CONTEXT.md` ที่ Linking ว่าทาง QR ไม่เทียบรหัสสั้น เขียน `manual-checks.md` ให้เจ้าของลองบน iPhone จริงกับเบราว์เซอร์บน Mac แล้วติ๊ก `linking-and-revocation` ใน `docs/roadmap.md` ใน commit ที่ archive
