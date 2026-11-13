## Why

issue #46: เครื่องที่ทำ sandbox ไม่ได้ไม่เปิด worker อยู่แล้ว แต่ผู้ใช้ไม่รู้ว่าขาด `bwrap` หรือ user namespace ถูกปิด และแก้อย่างไร

## What Changes

- supervisor ตรวจความพร้อมของ sandbox ก่อนเริ่ม Hub/worker
- Linux: หา `bwrap` และอ่านค่าที่บอกว่า user namespace ถูกจำกัด (Ubuntu 24.04 AppArmor / Debian sysctl)
- macOS: ตรวจ `/usr/bin/sandbox-exec`
- ถ้าไม่พร้อม พิมพ์สิ่งที่ขาดและวิธีแก้ที่เจาะจง แล้ว exit ด้วย code ที่ไม่ใช่ 0
- test ใช้ probe ที่ฉีดค่าได้ ไม่ผูกกับเครื่องที่รัน

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: ข้อความและ exit code เมื่อเครื่องทำ sandbox ไม่ได้ (implement ตาม requirement ที่มีอยู่)

## Impact

- runtime-core/supervisor: preflight module + การเรียกก่อนเริ่ม
- ไม่แตะ Controller/Hub
