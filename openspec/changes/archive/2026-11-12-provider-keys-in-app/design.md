## Context

- Machine identity เป็น Ed25519 `public_key` ที่ Controller เก็บตอน Pairing
- Runtime ถือ Ed25519 seed ใน `machine.key`
- ยังไม่มี sealed box หรือ `provider.add`; Provider ตั้งด้วย CLI
- ADR 0005/0042: key เข้ารหัสแยกต่อ Machine, Hub เปิดไม่ได้, supervisor ถือ key

## Decisions

### 1. แปลง Ed25519 เป็น X25519 แทนเพิ่ม key file

**Decision:** ใช้ Ed25519 public key ของ Machine แปลงเป็น X25519 (`to_montgomery`) และใช้ `SigningKey::to_scalar_bytes()` เป็น X25519 secret

**Why:** ไม่ต้องเปลี่ยน Pairing schema หรือเพิ่ม key file; identity เดิมใช้ได้

**Rejected:** เพิ่ม box key ใหม่ใน pairing — ต้องแก้ protocol/ทุกเครื่องและ machine ที่ pair แล้วใช้ไม่ได้

### 2. Sealed format

**Decision:** `base64url(ephemeralPub || nonce || AES-256-GCM ciphertext)`; shared secret จาก X25519; HKDF-SHA256 ด้วย salt `ephemeralPub || recipientPub` และ info `veeloe-provider-key-v1`

**Why:** Controller ใช้ pure JS `@noble/curves` + `@noble/ciphers`; Runtime ใช้ `x25519-dalek` + `aes-gcm`; มี test vector ข้ามภาษา

### 3. Runtime ตรวจ key ก่อนบันทึก

**Decision:** `provider.add` เปิด sealed key, เรียก `detect_auth`/models กับ Provider; ถ้าผ่านจึงเขียน `providers.json`; ชื่อซ้ำตอบ `provider.exists`

**Why:** ไม่เก็บ key ที่ใช้ไม่ได้ and ไม่สร้าง Provider ซ้ำ

### 4. Controller เก็บ key ใน memory เท่านั้น

**Decision:** ฟิลด์ key ไม่ถูกเก็บใน DB; ส่ง sealed payload แล้วล้างฟิลด์

**Why:** key อยู่บน Machine; Controller ไม่ควรเก็บ plaintext

## Risks

- ถ้า Machine เปลี่ยน identity หลัง pair ใหม่ key เก่าเปิดไม่ได้; ต้องเพิ่มใหม่
- URL/key ผิดตอบ error รวม; ไม่บอกว่า key หรือ URL ผิดเพื่อไม่ให้เป็น oracle
- `addProvider` ใช้ fresh authentication; emulator อาจข้ามได้ตาม key session

## Open decisions

- Preset picker และการแก้/ลบ Provider จากแอป
