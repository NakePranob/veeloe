## Why

`machine-pairing` ต้องมีกุญแจของ Controller ไว้เซ็น handshake และซอง และ ADR 0012 กำหนดให้กุญแจเปิดใช้ได้หลังยืนยันตัว เพื่อให้คนที่หยิบเครื่องที่ปลดล็อกอยู่ไปสั่ง Agent แทนเจ้าของไม่ได้

แยกจาก `controller-foundation` เพราะ biometric ต้องลองบน iPhone จริงก่อน archive

## What Changes

- กุญแจ Ed25519 ที่สร้างบนเครื่องและเปิดใช้ได้หลังยืนยันตัว ตอนเปิดแอปและหลังไม่ได้ใช้เกิน 5 นาที พร้อมทางยืนยันใหม่สำหรับการกระทำสำคัญที่ change ถัดไปจะเรียก (ADR 0012)
- หน้าสร้างกุญแจ หน้าล็อก และหน้ากุญแจใช้ไม่ได้ ทั้งไทยและอังกฤษ
- **แก้ ADR 0012 และ `CONTEXT.md`:** บนมือถือ biometric เท่านั้นที่ปลดล็อกกุญแจได้ รหัสเครื่องใช้ไม่ได้ เพราะ `requireAuthentication` ของ `expo-secure-store` บน iOS ผูกกับ `.biometryCurrentSet` ส่วนบนเว็บยังเป็นไปตาม passkey เดิม

## Capabilities

### New Capabilities
- `controller-device-key`: กุญแจของ Controller เกิด ถูกล็อก ถูกเปิด และแจ้งเมื่อใช้ไม่ได้อย่างไร

### Modified Capabilities

ไม่มี change นี้ใช้ `packages/protocol` ตามที่กำหนดไว้แล้ว

## Impact

- **โค้ดใหม่:** `controller/src/shared/keystore` และหน้าจอของกุญแจ
- **Dependency ใหม่:** `expo-secure-store` และ `expo-crypto`
- **เอกสาร:** ADR 0012 และ `CONTEXT.md`
- **การรันบนมือถือ:** ต้องใช้ development build เพราะ `requireAuthentication` ใช้ใน Expo Go ไม่ได้ และ biometric ต้องลองบนเครื่องจริง
- **change ถัดไป:** `machine-pairing` ใช้กุญแจเซ็น handshake และซอง
