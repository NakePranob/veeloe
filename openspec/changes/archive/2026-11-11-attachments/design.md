## Context

- `task.message` เดิมมีแค่ text
- Runtime dispatch มี `Machine` state; เพิ่ม `Uploads` ได้โดยไม่แตะ Hub
- Controller ใช้ Expo document picker; native module ต้อง rebuild dev client
- ADR 0050: message ประกาศ hash ก่อน, chunks ตามหลัง, Hub ไม่เก็บ

## Decisions

### 1. Chunks ก่อน message

**Decision:** Controller ส่ง `file.chunk` ทุกก้อนก่อน แล้วจึงส่ง `task.message` ที่มี metadata

**Why:** Runtime ไม่ต้องถือ pending message รอไฟล์; เมื่อ message มาถึง ไฟล์ครบหรือ error ทันที

**Trade-off:** ไม่ตรงลำดับ "message first" ตาม ADR 0050 แต่ยังรักษา hash declaration และ Hub ไม่เก็บ; เปลี่ยนภายหลังได้ถ้าต้องการ streaming

### 2. Hash เป็น base64url ของ SHA-256

**Decision:** ใช้ `hashBytes()` ฝั่ง Controller และ `Sha256` ฝั่ง Rust; `file`/`hash` เป็น base64url

**Why:** ไม่ต้องเพิ่ม hex dependency; ตรงกับ base64url ที่ protocol ใช้

### 3. เก็บ chunk ใน memory จนครบ

**Decision:** `Uploads` เก็บ `Vec<Option<Vec<u8>>>` ต่อ hash, cap 20 MB, ตรวจ hash แล้วเก็บใน `done`

**Why:** ไฟล์ v0.1 ไม่ใหญ่; ง่ายและไม่ทิ้งไฟล์เสียลงดิสก์

### 4. เขียนไฟล์เมื่อ message มาถึง

**Decision:** `task.message` ดึงไฟล์จาก `done`, ตรวจ size, เขียน `attachments/<task>/<safe-name>` และเพิ่ม path ในข้อความถึง worker

**Why:** Agent ใช้ file tools เดิม; event log เก็บข้อความ/path ไม่เก็บ binary

### 5. Native picker ต้อง rebuild

**Decision:** ใช้ `expo-document-picker`; build dev client ใหม่; pin `expo-sqlite` 58.0.13 ที่ build ผ่าน

**Why:** 58.0.15 ทำให้ prebuild/autolinking ของ SQLite ไม่ลง module ในเครื่องนี้; 58.0.13 build ผ่านและแอปเปิดได้

## Risks

- ไฟล์ค้างใน memory ถ้า message ไม่มา; ยังไม่มี cleanup timer
- ชื่อไฟล์ถูก sanitize; ชื่อซ้ำจะเขียนทับ
- ข้อความ path อาจยาว; UI แสดงตามที่ Agent เห็น
- `sendAttachment` ใช้ `fetch(file.uri)`; ไฟล์ใหญ่กิน memory
