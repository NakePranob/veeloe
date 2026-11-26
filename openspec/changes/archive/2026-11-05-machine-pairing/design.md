## Context

- `hub/` ยืนยันตัวด้วยกุญแจและส่งต่อซองได้ แต่ไม่มีทางเขียน `machines` กับ `controllers` และ `workspace_id` ยังไม่มีตารางรองรับ
- `packages/runtime` ถูกลบใน `33deb1a` แต่กู้ `config`, `machine-key`, `hub-link` และ `backoff` จาก `33deb1a~1` ได้
- `controller/` มีกุญแจและ `withFreshAuthentication` แล้ว แต่ไม่มี protocol client `controller-device-key` ยังเปิดค้างเพื่อรอลองบนเครื่องจริง ถ้าลองแล้วต้องแก้ จะกระทบ `shared/keystore` เท่านั้น
- ADR 0006 และ 0035 ให้แลกกุญแจผ่าน QR บนจอ Machine เพื่อไม่ให้ Hub เป็นคนส่งกุญแจ

## Goals / Non-Goals

**Goals:**
- Hub ที่โดนเจาะสลับกุญแจของฝั่งใดฝั่งหนึ่งไม่ได้
- จบ change นี้แล้ว Owner สั่ง `veeloe pair` แล้วเห็น Machine บนแอปได้จริงกับ Hub, Postgres และ Runtime ตัวจริง

**Non-Goals:**
- Agent, Task และ supervisor กับ worker อยู่ใน `agent-and-task`
- โควตาตอน Pairing, Invitation, Owner หลายคน และการย้าย Machine อยู่ใน v0.3
- Linking อยู่ใน `linking-and-revocation`
- สถานะออนไลน์ของ Machine อยู่ใน `logs-and-machine-status`
- ติดตั้ง Runtime เป็น service และ binary ที่เซ็นแล้ว

## Decisions

### ลำดับของ Pairing

1. Machine สุ่มรหัสลับ เซ็น `(hub, กุญแจ Machine, expires)` แสดงลิงก์ `veeloe://pair?...` แล้วพยายามต่อ Hub ซ้ำ โดยจะถูกปิดด้วย 4401 จนกว่า Hub จะรู้จัก
2. Controller ตรวจลิงก์ ถามเจ้าของ และยืนยันตัวใหม่
3. Controller ส่ง `POST /pairings` พร้อมลายเซ็นของ Machine จากลิงก์และลายเซ็นของตัวเอง Hub ตอบรหัส Workspace, Member และ Machine
4. Machine ต่อ Hub ได้ และ Controller ต่อ Hub แล้วส่ง `pairing.claim`
5. Machine ตรวจแล้วบันทึกกุญแจ ตอบ `pairing.done` พร้อมชื่อเครื่อง
6. Controller ตรวจลายเซ็นกับกุญแจจากลิงก์แล้วบันทึก Machine

### รหัสลับอยู่ใน QR เท่านั้น ไม่อยู่ที่ Hub

`pairing.claim` มี `proof = HMAC-SHA256(secret, context | machineKey | controllerKey | member)` โดยส่วนนี้ผ่าน Hub เฉพาะ MAC ไม่เคยส่งรหัสลับ Hub ที่จะสลับกุญแจต้องคำนวณ MAC ใหม่ซึ่งทำไม่ได้ และรหัส 256 bit เดาจาก MAC ไม่ได้ ถ้าใช้รหัสสั้นที่พิมพ์ได้ Hub ที่เห็น MAC จะเดาแบบ offline ได้ จึงเป็นรหัสยาวและส่งผ่าน QR หรือลิงก์เท่านั้น

ทางเลือกที่ตัดออก:
- **รหัสใช้ครั้งเดียวที่ Hub เก็บตาม ADR 0014**: ทำให้ Hub เป็นคนจับคู่ จึงสลับกุญแจได้ จึงแก้ ADR 0014 ออก
- **ส่งกุญแจของ Controller ให้ Machine ทาง QR ที่สองบนมือถือ**: ไม่ต้องผ่าน Hub เลย แต่เซิร์ฟเวอร์ผ่าน SSH ไม่มีกล้อง

### Machine ยินยอมด้วยลายเซ็นในลิงก์ ไม่ใช้ตารางคำขอ

ถ้า Hub ลงทะเบียนกุญแจอะไรก็ได้ ใครก็ยึดกุญแจสาธารณะของเครื่องคนอื่นเข้า Workspace ตัวเองได้ และเจ้าของเครื่องจะต่อ Hub เข้า Workspace ผิด ลายเซ็นของ Machine ที่มีวันหมดอายุป้องกันเรื่องนี้โดยไม่ต้องมี state ฝั่ง Hub ส่วน Controller เซ็นครอบข้อมูลเดียวกันกับ URL ของ Hub จึงเอาลายเซ็นไปใช้กับ Hub อื่นไม่ได้

### Workspace เป็น module `pairing` เดียวก่อน

module `pairing` เป็นเจ้าของ `POST /pairings` และเขียนลงสองตารางเดิมใน transaction เดียวผ่าน `shared/tx` และมีตาราง `workspace_svc.workspaces(id, created_at)` พร้อม foreign key จากสองตาราง ตาม comment ใน migration เดิม Member ID สร้างที่ Hub รูปแบบ `m_<สุ่ม>` ค่า `Owner` ยังไม่อยู่ที่ Hub เพราะ Runtime เป็นคนถือความจริงเรื่องสิทธิ์ (ADR 0006)

ยืนยันกับ `go-scaffold check` ในงานแรกของกลุ่มว่าการเขียนข้ามสอง schema ผ่าน module เดียวถูกกฎ ถ้าไม่ผ่านให้ใช้ `internal/composition` เหมือน `RelayIdentities`

### `seq` ของ Controller มาจากนาฬิกาโดยไม่ต้องเก็บ

ค้างจาก `controller-device-key`: Keychain รอดการลบแอปแต่ SQLite ไม่รอด และบนเว็บทั้งสองหายแยกกันได้ `nextSeq = max(Date.now(), last + 1)` จึงเดินหน้าเสมอโดยไม่ต้องเก็บอะไร ผู้รับยังเทียบแค่เลขตาม `protocol-envelope` ไม่ได้อ่านนาฬิกา และ spec อนุญาตเลขข้าม

ทางเลือกที่ตัดออก: เก็บเลขข้างกุญแจ ซึ่งต้องเขียน Keychain ทุกซองและ IndexedDB ก็ยังหายได้

ข้อจำกัดคือถ้าตั้งนาฬิกาเครื่องย้อนหลังแล้วเปิดแอปใหม่ ซองจะถูกปฏิเสธจนกว่าเวลาจะทัน Runtime ใช้เลขที่เก็บในไฟล์ตามเดิม เพราะมีที่เก็บถาวร

### Runtime เก็บ state เป็นไฟล์ JSON สองไฟล์

`trust.json` เก็บ `{ owners: [{ member, keys }] }` ตาม ADR 0031 และ `seen.json` เก็บเลขล่าสุดต่อกุญแจ โดยเขียนไฟล์ชั่วคราวแล้ว rename ทั้งคู่สิทธิ์ 0600 ADR 0020 ให้ supervisor เก็บ state ในไฟล์ของตัวเอง

`veeloe unpair` ลบ `trust.json`, `seen.json` และ `machine.key` ถ้าเก็บกุญแจเดิมไว้ Hub จะเก็บเครื่องไว้ใน Workspace เดิมและตอบ `hub.machine_taken` ตลอดไป แถวเก่าที่ Hub จึงค้างอยู่จนกว่าจะมีการถอน

### Controller มี `shared/hub-client` ก้อนเดียว

ทำ handshake, ต่อใหม่, เซ็นซอง และตรวจซองขาเข้า ADR 0022 วาง protocol client ไว้ใน shared ส่วน REST เรียกด้วย `fetch` เปลี่ยน `wss://` เป็น `https://` และ `POST /pairings` ต้องอนุญาต CORS ตามที่ `/connect` เปิดให้ทุก origin เพราะมีลายเซ็นเป็นด่าน ไม่ใช้ cookie

หน้าเพิ่ม Machine กับขั้นตอน Pairing อยู่ใน `pages/add-machine` เพราะมีที่ใช้ที่เดียว (Steiger ไม่ให้แยก slice ที่มีคนใช้คนเดียว) และ `entities/machine` เก็บตาราง `machine` ใน SQLite ใช้ migration ใหม่กับ `useLiveQuery` ต่อจากที่วางไว้

ทั้งการสแกนด้วย `expo-camera` และการวางลิงก์ใช้ `parsePairingLink` ตัวเดียว การวางจำเป็นเพราะ Simulator ไม่มีกล้องและ Controller บนเว็บอาจไม่มีกล้อง จึงมีทุก platform

### e2e ใช้ Hub กับ Postgres จริง

`cmd/testhub` ไม่มี database จึงทดสอบเรื่องนี้ไม่ได้ เพิ่ม test ที่รัน `cmd/api` กับ migration และ `veeloe pair` จริง โดยใช้ client จาก Protocol แทน Controller และเพิ่ม service Postgres ใน job `e2e` test ข้ามตัวเองเมื่อไม่มี `TEST_DB_DSN` เว้นแต่ตั้ง `REQUIRE_TEST_DB`

## Risks / Trade-offs

- [ลิงก์ Pairing คือความลับ ถ้า terminal ถูกแชร์คนอื่นจะ Pairing ได้ก่อน] → หมดอายุใน 10 นาทีและใช้ได้ครั้งเดียว เจ้าของเห็นทันทีเพราะ `pair` จบและแอปตัวเองล้มเหลว จึงรัน `unpair` ได้
- [ผู้ถือลิงก์ที่หมดอายุแล้ว] → Hub กับแอปตรวจเวลาหมดอายุ ส่วน Machine เลิกรอแล้วจึงไม่ทำอะไรต่อ
- [นาฬิกาของ Machine กับ Controller ไม่ตรงกัน ทำให้ลิงก์ดูหมดอายุ] → เผื่อ 2 นาทีที่ Hub และ Controller
- [Hub ทิ้ง `pairing.claim` หรือไม่ส่งต่อ] → Pairing ล้มเหลว แต่สลับกุญแจไม่ได้ ADR 0006 ยอมรับว่า Hub ที่โดนเจาะตัดการสื่อสารได้
- [Hub สร้างแถว Machine แล้ว claim ไม่สำเร็จ ทำให้มี Machine ค้าง] → คำขอซ้ำได้ผลเดิม และ v0.1 ยังไม่คิดเงินตาม Machine ต้องกลับมาดูเมื่อทำโควตาใน v0.3
- [`controller-device-key` ยังไม่ผ่านบน iPhone จริง] → งานนี้เรียกแค่ `secretKey` กับ `withFreshAuthentication` ซึ่งไม่น่าเปลี่ยน แต่ลองบนมือถือจริงพร้อมกันได้
