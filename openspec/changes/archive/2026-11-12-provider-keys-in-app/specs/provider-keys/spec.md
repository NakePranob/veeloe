# Spec Delta

## Purpose

กำหนดการเพิ่ม Provider จาก Controller โดยส่ง key ที่ปิดผนึกให้ Machine เท่านั้น และให้ Runtime ตรวจและบันทึก Provider

คำศัพท์: **Sealed key** คือ base64url ของ `ephemeral public || nonce || AES-GCM ciphertext`; **Machine identity** คือ Ed25519 public key จาก Pairing; **Provider** คือ LLM endpoint ที่ Machine ใช้

## ADDED Requirements

### Requirement: Controller เพิ่ม Provider ด้วย sealed key
Controller SHALL ให้ Owner เพิ่ม Provider ด้วย name, base URL และ API key; Controller MUST seal key ให้ Machine identity และ MUST NOT เก็บ plaintext key ในฐานข้อมูล; Hub MUST NOT สามารถเปิด sealed key ได้

#### Scenario: เพิ่ม Provider สำเร็จ
- **WHEN** Owner กรอก name/URL/key แล้วยืนยันตัวและกด Save
- **THEN** Runtime เปิด sealed key, ตรวจ Provider, บันทึก และตอบรายการที่มี Provider ใหม่

#### Scenario: Key ถูกดักระหว่างทาง
- **WHEN** ผู้ไม่ใช่ Machine ได้ sealed payload
- **THEN** เปิดไม่ได้เพราะไม่มี X25519 secret ของ Machine

### Requirement: Runtime ตรวจ Provider ก่อนบันทึก
Runtime SHALL เปิด sealed key ด้วย seed ของ Machine, ตรวจ name/URL/key กับ Provider; MUST ปฏิเสธ name ซ้ำหรือ key ที่ใช้ไม่ได้ และ MUST NOT เขียน `providers.json` เมื่อตรวจไม่ผ่าน

#### Scenario: Key ใช้ไม่ได้
- **WHEN** Provider ตอบ 401/403 หรือเชื่อมต่อไม่ได้
- **THEN** Runtime ตอบ error และไม่เพิ่ม Provider

#### Scenario: ชื่อซ้ำ
- **WHEN** มี Provider ชื่อเดียวกันอยู่แล้ว
- **THEN** Runtime ตอบ `provider.exists` และไม่เขียนทับ
