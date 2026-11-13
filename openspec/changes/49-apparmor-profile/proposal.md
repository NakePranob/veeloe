## Why

issue #49 (story 33 ของ #32): Ubuntu 24.04 ปิด user namespace โดย AppArmor; ทางแก้ที่ปลอดภัยคือ profile ที่อนุญาตเฉพาะ bwrap แต่ตอนนี้ Veeloe ยังไม่มี profile/ตัวติดตั้งของตัวเอง ผู้ใช้ต้องไปหาเอง

## What Changes

- เพิ่ม AppArmor profile ของ Veeloe ที่อนุญาต `userns` เฉพาะ `/usr/bin/bwrap` (ไฟล์ใน repo + ฝังใน binary)
- เพิ่มคำสั่ง `veeloe doctor --fix-apparmor` สำหรับติดตั้ง/โหลด profile (ต้อง root) และตรวจผล
- preflight ชี้ให้ใช้คำสั่งนี้เมื่อเจอ restriction
- macOS/ระบบที่ไม่มี AppArmor: บอกว่าไม่ต้องใช้

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: การติดตั้ง AppArmor profile สำหรับ bwrap

## Impact

- runtime-supervisor: CLI doctor, เนื้อหา profile, preflight message
- packaging: ไฟล์ profile
- test: เนื้อหา/สิทธิ์/ข้อความ; การโหลดจริงต้อง Ubuntu 24.04
