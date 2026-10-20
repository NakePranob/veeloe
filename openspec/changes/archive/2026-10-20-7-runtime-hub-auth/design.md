## Context

แรงจูงใจอยู่ใน proposal.md (Why) ส่วนพฤติกรรมที่ต้องได้อยู่ใน specs ทั้งสามไฟล์ ตอนนี้โค้ดมีแค่โครงจาก #6:

- `packages/protocol` มีแค่ `PROTOCOL_VERSION`
- supervisor กับ worker ของ Runtime ยังเป็น stub
- Hub มี module `relay` แบบ `--surface none` ที่ยังว่าง ยังไม่มี migration
- e2e เปิด Postgres กับ Hub ได้แล้ว แต่ยังไม่รัน migration

ข้อจำกัดที่กำหนดแนวทาง:
- Hub เห็นแค่หัวซอง (ADR 0005, 0007)
- ลายเซ็นครอบ byte ตามที่ส่งจริง (ADR 0019)
- ข้อความสุ่มอยู่ใน frame แรก ไม่ได้อยู่ใน header (ADR 0013)
- relay เป็น module ของ scaffold, keyauth อยู่ใน `internal/shared/middleware` และรับฟังก์ชันหากุญแจเข้ามา, presence อยู่ในหน่วยความจำ, WebSocket adapter อยู่ใน `adapters/inbound/http/ws.go` และใช้ `coder/websocket` (ADR 0022)

## Goals / Non-Goals

**Goals:**
- ซองกับขั้นตอนตรวจฝั่งรับที่ Runtime และ Controller ใช้ต่อได้ทันทีในตั๋วถัดไป
- รูปแบบของข้อความบนสายที่ test vector ตรึงไว้ ทั้ง TypeScript กับ Go จะได้ไม่เพี้ยนจากกัน
- การจับมือกับ Hub ที่ Controller ใช้ซ้ำได้ใน #8 โดยแค่เปลี่ยนฟังก์ชันหากุญแจ

**Non-Goals:**
- ยังไม่ส่งต่อซองระหว่างสาย (relay routing มาพร้อมคำสั่งแรกใน #9)
- ยังไม่เก็บเลขต่อผู้ส่งลงดิสก์ เพราะยังไม่มีข้อความที่เซ็นแล้ววิ่งถึง Runtime ใน change นี้มีแค่ interface กับตัวที่เก็บในหน่วยความจำ
- ไม่มี TLS ใน change นี้ (Caddy มาใน #27) และไม่มี E2E

## Decisions

### 1. ซองพกส่วนที่เซ็นเป็น JSON string ทั้งก้อน

```json
{ "v": 1, "type": "<type>", "from": "<sender key>", "to": "<destination>",
  "task": "<task id>", "member": "<member id>",
  "signed": "{\"type\":…,\"to\":…,\"seq\":7,\"body\":{…}}", "sig": "<sig>" }
```

- **หัวซอง:** `v`, `type`, `from`, `to` กับ `task` และ `member` ที่มีเมื่อเกี่ยวข้อง Hub อ่านแค่ส่วนนี้
- **`signed`:** ข้อความ JSON ของส่วนที่เซ็นตามตัวอักษร มีสำเนาของ `type`, `to`, `task` และ `member` พร้อม `seq` และ `body`
- **`sig`:** Ed25519 ของ UTF-8 ของ `signed`
- **`from`:** บอกฝั่งรับว่าต้องใช้กุญแจไหนตรวจ ไม่ต้องคัดลอกลงส่วนที่เซ็น เพราะถ้าเปลี่ยน `from` ลายเซ็นจะไม่ผ่านอยู่แล้ว

ที่เลือกเป็น string เพราะตัวที่ parse ซองชั้นนอกแล้ว serialize ใหม่ระหว่างทาง (เช่น Hub ฝั่ง Go) อาจเปลี่ยนวิธี escape ได้ แต่ได้ code point ชุดเดิมเสมอ UTF-8 ที่ได้จึงเป็น byte ชุดเดิม และยังเปิดอ่านตอน debug ได้ ซึ่งเป็นเหตุผลที่ ADR 0019 เลือก JSON ทางเลือกที่ไม่เลือก:
- **base64 ของ byte:** ชัดเจนที่สุด แต่เปิดอ่านไม่ได้
- **object ซ้อนตรงๆ:** แบบนี้ต้อง serialize ใหม่ก่อนตรวจ ซึ่ง ADR 0019 ปฏิเสธไปแล้ว

`type` อยู่ในสำเนาด้วย แม้ ADR 0019 จะไม่ได้ระบุไว้ เพื่อไม่ให้ Hub เปลี่ยนชนิดของคำสั่งได้ ข้อนี้เป็นการเพิ่ม ไม่ได้ขัดกับ ADR

### 2. ขั้นตอนตรวจฝั่งรับเป็นฟังก์ชันเดียวใน Protocol

`verify(envelope, trustedKeys, seen)` ทำตามลำดับนี้:
1. หา `from` ใน `trustedKeys`
2. ตรวจ `sig` กับ byte ของ `signed`
3. `JSON.parse` แล้วตรวจรูปร่างด้วย Zod แบบ loose
4. เทียบหัวซองกับสำเนาในส่วนที่เซ็น
5. ตรวจว่า `seq` มากกว่า `seen.last(from)` แล้วจดเลขใหม่

ผลลัพธ์เป็นค่าที่บอกได้ว่าไม่ผ่านเพราะข้อไหน ไม่ได้ throw `seen` เป็น interface ใน change นี้มีแค่ตัวในหน่วยความจำ ส่วนตัวที่เก็บใน SQLite ของ supervisor มาพร้อม #9 ฝั่งส่งใช้ `createSigner(privateKey, nextSeq)` ซึ่งรับตัวนับเข้ามา เพราะเลขต้องเพิ่มต่อเนื่องแม้โปรแกรมจะ restart

### 3. การจับมือกับ Hub ใช้ frame ธรรมดา ไม่ใช้ซอง

ลำดับ frame:
1. Hub ส่ง `{ "type": "hub.challenge", "v": 1, "nonce": "<32 byte>" }`
2. ฝั่งต่อตอบ `{ "type": "hub.auth", "key": "<public key>", "sig": "<sig>" }` โดยเซ็น byte ของ `veeloe-hub-auth/1` + `\n` + URL สาธารณะของ Hub + `\n` + nonce
3. ถ้าผ่าน Hub ตอบ `{ "type": "hub.ready", "machine": "<machine id>" }`
4. ถ้าไม่ผ่าน Hub ปิดสายด้วย close code ในช่วง 4000:
   - **4401:** พิสูจน์ตัวตนไม่ผ่าน
   - **4408:** หมดเวลาจับมือ
   - **4409:** มีสายใหม่มาแทน

ที่ไม่ใช้ซองเพราะคนตรวจคือ Hub เอง และ nonce ที่สุ่มใหม่ทุกสายก็กันการส่งซ้ำได้แล้ว Hub จึงไม่ต้องเก็บเลขต่อผู้ส่ง คำตอบเก่าจากสายก่อนใช้ไม่ได้ เพราะเซ็นไว้กับ nonce ของสายนั้น

ที่ผูก URL ของ Hub ไว้ในลายเซ็นเพราะ ADR 0016 ให้ตั้ง URL ของ Hub เองได้ Hub ปลอมจึงอาจเอา challenge ของ Hub จริงมาให้ Runtime เซ็น แล้วใช้ลายเซ็นนั้นเข้า Hub จริงในนามของ Machine การผูก URL ที่ Runtime ต่อจริงปิดช่องนี้ ทั้งสองฝั่ง normalize URL แบบเดียวกัน คือ scheme กับ host เป็นตัวเล็ก ตัด `/` ท้าย และไม่มี path ส่วน Runtime ต่อไปที่ `<URL>/connect`

กุญแจ ลายเซ็น และ nonce ทั้งหมดเข้ารหัสเป็น base64url แบบไม่มี padding

### 4. Hub: module `machine` เก็บกุญแจ ส่วน `relay` ตรวจผ่าน port

**module `machine`:**
- สร้างด้วย `go-scaffold generate module machine --profile lean`
- ตาราง `machines` มี `id`, `workspace_id`, `public_key` (32 byte และ unique) กับ `created_at` `workspace_id` ยังไม่มี FK เพราะตาราง Workspace มาใน #8 ซึ่งจะเพิ่ม FK ใน migration ของตัวเอง
- ยังไม่มี route HTTP ถ้า scaffold สร้างมาให้ก็ลบออก
- มีความสามารถเดียวคือหา Machine จากกุญแจสาธารณะ

**module `relay`:**
- มี port `MachineKeys` (หากุญแจ) กับ `PresenceRegistry` (ตัวในหน่วยความจำ)
- `MachineKeys` ได้มาจาก adapter ใน `internal/composition` สอง module จึงไม่ import กันเอง ตาม ADR 0022
- domain มีกฎของ presence คือสายใหม่ที่ใช้กุญแจเดียวกันแทนสายเก่า

**keyauth:**
- เป็น package ใน `internal/shared/middleware` ทำการจับมือบนสาย WebSocket ที่เปิดแล้ว
- รับ conn, ฟังก์ชันหากุญแจ, URL สาธารณะ และ timeout ส่วน #8 จะใช้ซ้ำกับกุญแจของ Controller
- ตั้ง read limit ของ frame ก่อนจับมือให้ต่ำ (เช่น 4 KiB) กันคนส่งก้อนใหญ่เข้ามาก่อนพิสูจน์ตัวตน
- timeout ของการจับมือใช้ timer ที่ปิดสายด้วย close code 4408 ไม่ได้ใช้ deadline ของ context เพราะถ้า context ของ `Read` หมดเวลา coder/websocket จะตัดสายทิ้งโดยไม่ส่ง close frame แล้ว client จะไม่รู้สาเหตุ

**heartbeat และ config:**
- heartbeat ใช้ `conn.Ping` ทุกช่วง `HUB_HEARTBEAT_INTERVAL` (ค่าเริ่มต้น 15 วินาที) ถ้าไม่ตอบภายในช่วงเดียวกันจะปิดสายและนับว่าออฟไลน์
- `HUB_HANDSHAKE_TIMEOUT` ค่าเริ่มต้น 10 วินาที
- `HUB_PUBLIC_URL` ต้องตั้งเมื่อ `APP_ENV=production` ส่วนตอน dev ค่าเริ่มต้นคือ `ws://localhost:<PORT>`

ทางเลือกที่ไม่เลือก:
- **seed กุญแจผ่าน env:** ไม่ต้องมี migration แต่เป็นทางลัดของ test ที่จะติดไปกับโค้ดจริง
- **ให้ relay import machine ตรงๆ:** ผิดกฎของ go-scaffold

### 5. JSON Schema กับ test vector อยู่ใน Protocol แล้วทุกภาษาอ่านไฟล์ชุดเดียวกัน

**JSON Schema:**
- `z.toJSONSchema()` ของ Zod v4 สร้าง schema ของหัวซองเป็นไฟล์ที่ commit ไว้ใน `packages/protocol`
- test ฝั่ง TypeScript ล้มเมื่อไฟล์ไม่ตรงกับ schema ปัจจุบัน และมีสคริปต์ให้สร้างไฟล์ใหม่

**test vector:**
- สร้างจาก seed ที่ตายตัว ทุกกุญแจเป็นของ test เท่านั้นและเขียนกำกับไว้
- ครอบ envelope ที่ถูกต้อง, envelope ที่ถูกเปลี่ยนทาง, ลายเซ็นผิด, เลขซ้ำ, field ที่ไม่รู้จัก และข้อความภาษาไทยกับอักขระที่ต้อง escape
- มีคำตอบ challenge ทั้งแบบถูกต้อง แบบเซ็นกับ URL อื่น และแบบเซ็นกับ nonce อื่น

**ฝั่ง Go:**
- struct ของหัวซองกับข้อความจับมืออยู่ใน `internal/shared/protocol` เพราะ relay จะใช้ route ในตั๋วถัดไป และ keyauth ใช้ส่วนของการจับมือ
- test เทียบชื่อ field กับชนิดใน json tag กับ JSON Schema และตรวจลายเซ็นของ vector ทุกตัวด้วย `crypto/ed25519` ของ stdlib ซึ่งพิสูจน์ด้วยว่า byte ที่ Go เห็นตรงกับที่ TypeScript เซ็น

ทางเลือกที่ไม่เลือก:
- **สร้าง struct ของ Go จาก schema:** ต้องมี toolchain เพิ่ม ทั้งที่หัวซองมีไม่กี่ field

### 6. Runtime: supervisor มี config, trust และ hub-link

slice ของ supervisor แบ่งตาม ADR 0022:

**config:**
- โฟลเดอร์ของ Runtime คือ `VEELOE_HOME` ค่าเริ่มต้น `~/.veeloe` สร้างด้วยสิทธิ์ 0700
- `config.json` มี `hubUrl` และ `VEELOE_HUB_URL` ทับค่านี้ได้

**trust:**
- เก็บ seed 32 byte ของกุญแจไว้ใน `machine.key` สิทธิ์ 0600
- ถ้าไฟล์เปิดให้ group หรือ other อ่านหรือเขียนได้ จะไม่ยอมเริ่ม แบบเดียวกับ ssh

**hub-link:**
- ใช้ WebSocket ของ Bun แล้วจับมือตามข้อ 3
- พอได้ `hub.ready` จะพิมพ์ว่าต่อแล้วพร้อม Machine id
- backoff เริ่ม 1 วินาที คูณสองทุกครั้งจนถึง 30 วินาที สุ่มแบบ full jitter และกลับไปเริ่มใหม่หลังต่อสำเร็จ ส่วน Runtime ฝั่ง Bun ตอบ ping ให้เอง

ทางเลือกที่ไม่เลือก:
- **เก็บกุญแจใน Keychain ของ OS:** ADR 0012 ให้ใช้ไฟล์ 0600 บน Machine อยู่แล้ว
- **ไม่มีค่า Hub เริ่มต้น:** เลือกแล้ว จนกว่า Hub ตัวจริงจะขึ้นใน #27

### 7. e2e ใช้ binary จริง ส่วนกรณีที่ต้องปฏิเสธใช้ client ที่เขียนใน test

**ก่อนเปิด Hub:**
- preload ของ e2e รัน `make migrate-up` กับ database ของ test ก่อนเปิด Hub
- เปิด restart ให้ test เรียกได้

**กรณีที่ต่อได้:**
- test เขียน `machine.key` จาก seed ของ test ลงโฟลเดอร์ชั่วคราว แล้ว insert กุญแจสาธารณะคู่กันลง `machines` ด้วย `Bun.SQL` (มากับ Bun จึงไม่ต้องเพิ่ม dependency)
- เปิด binary ของ Runtime ที่ build แล้ว และรอจนเห็นบรรทัดที่บอกว่าต่อแล้ว

**กรณีที่ต้องถูกปฏิเสธ:**
- กุญแจที่ไม่รู้จัก, ลายเซ็นผิด, URL อื่น, คำตอบเก่า, เงียบจนหมดเวลา และส่ง frame อื่นก่อน
- ใช้ client ที่เขียนใน test ด้วยฟังก์ชันของ Protocol แล้วตรวจ close code

**presence:**
- การนับออฟไลน์ตอน heartbeat ไม่ตอบ ตรวจด้วย Go test ใน `composition_test.go` ของ relay เพราะข้างนอก Hub ยังไม่มีที่ให้ดู presence ได้ (จะมีตอน Controller มาใน #8)
- client ใน test หยุดอ่าน frame ทำให้ไม่ตอบ pong

## Risks / Trade-offs

- **[`http.Server` ตั้ง `ReadTimeout`/`WriteTimeout` ไว้ 10 วินาที ซึ่งอาจตัดสาย WebSocket ที่ hijack ไปแล้ว]** → ตอนลงมือพบว่า net/http ล้าง deadline ให้เองตอน hijack จึงไม่ต้องทำอะไรเพิ่ม Go test ต่อสายค้างนานกว่า timeout ของ server ที่ตั้งให้สั้นไว้คอยกันไม่ให้เรื่องนี้กลับมา
- **[วิธี escape ใน JSON ของสองภาษาต่างกัน]** → vector มีข้อความภาษาไทย อักขระควบคุม และ `\u` และทั้งสองภาษาต้องตรวจผ่าน
- **[Hub restart แล้ว presence หายหมด]** → เป็นไปตาม ADR 0022 Runtime ต่อกลับเองด้วย jitter เพื่อไม่ให้ทุกเครื่องต่อพร้อมกัน
- **[กุญแจของ test อยู่ใน repo สาธารณะ]** → สร้างจาก seed ที่ตั้งชื่อชัดว่าเป็นของ test และไม่ใช้กุญแจนี้นอก test ที่ไหนเลย
- **[Zod v4 และ @noble/curves v2 เปลี่ยน API ได้]** → pin เวอร์ชันใน package.json
- **[ระบบไฟล์ที่ไม่รองรับสิทธิ์แบบ POSIX เช่นไดรฟ์ Windows ที่ mount เข้า WSL]** → ข้อความ error บอกให้ย้าย `VEELOE_HOME` ไปไว้ในระบบไฟล์ของ Linux

## Migration Plan

- migration แรกของ Hub สร้างตาราง `machines` ส่วน down migration ลบตารางนี้
- ยังไม่มี Hub ตัวจริงที่ต้อง deploy จึงไม่มีขั้นย้ายข้อมูล
