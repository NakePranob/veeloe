## Why

ADR 0005 ต้องการให้ Owner ใส่ Provider key ในแอปครั้งเดียว แล้วแอปเข้ารหัสแบบ sealed box ให้แต่ละ Machine ปัจจุบันตั้ง Provider ได้เฉพาะ `veeloe provider add` บนเครื่อง ทำให้ onboarding จากมือถือไม่สมบูรณ์

## What Changes

- Controller เพิ่ม Provider จากหน้า Machine: name, base URL, API key
- Controller เข้ารหัส key ด้วย Ed25519 public key ของ Machine (แปลงเป็น X25519) + HKDF + AES-256-GCM; ส่ง `provider.add`
- Runtime เปิด sealed box ด้วย seed ของ Machine, ตรวจ key กับ Provider, บันทึก `providers.json` และตอบ `agent.listed`
- Hub ส่งต่อ sealed payload โดยเปิดไม่ได้
- มี test vector ข้าม TypeScript/Rust และ UI จริงบน Android

## Capabilities

### New Capabilities

- `provider-keys`: การเพิ่ม Provider key จาก Controller แบบ sealed box

### Modified Capabilities

- `runtime-providers`: รับ `provider.add`
- `controller-tasks`: หน้า Machine มีฟอร์มเพิ่ม Provider

## Non-goals

- แก้/ลบ Provider จากแอป (CLI ยังเป็นทางเดียว)
- Preset picker ครบทุกเจ้า; รอบนี้ใส่ name/URL/key เอง
- หมุน key อัตโนมัติหรือ sync key ไปหลาย Machine

## Impact

- **Protocol:** `provider.add` body `{name,url,preset?,key}`
- **Crypto:** sealed box X25519 + HKDF-SHA256 + AES-256-GCM; TS `sealFor`, Rust `sealed::open`
- **Runtime:** `provider.add` ใน dispatch, `Machine.secret_key`
- **Controller:** `links.addProvider`, ฟอร์มใน MachinePage, i18n
- **Hub:** ไม่เปลี่ยน

## Acceptance anchor cases

- ใส่ mock Provider ในแอปแล้ว Machine แสดง Provider + model
- Key ที่ดักได้ระหว่างทางเปิดไม่ได้ถ้าไม่ใช่ Machine
- Key ผิด/URL ผิดได้ error ที่อ่านรู้เรื่อง
- ปิด/เปิดแอปแล้ว Provider ยังอยู่บน Machine
