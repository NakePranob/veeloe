## Why

ตอน Link เครื่องใหม่ Controller ตั้งชื่อเครื่องจากชื่อที่ผู้ใช้อนุมัติ แต่หลัง Link แล้วยังเปลี่ยนชื่อไม่ได้ หน้า My devices จึงค้างชื่อเดิมตลอด แม้ผู้ใช้จะเปลี่ยนหน้าที่ของเครื่องนั้นไปแล้ว

ชื่อเครื่องเป็น metadata ของ Controller ไม่ใช่ certificate ที่ Runtime ต้องเชื่อ จึงเปลี่ยนในฐานข้อมูลของ Controller เครื่องนั้นได้โดยไม่ต้องออก certificate ใหม่หรือให้ Hub เก็บชื่อ

## What Changes

- หน้า My devices เปิดช่องเปลี่ยนชื่อ Controller ที่ยังใช้งานอยู่
- บันทึกชื่อใหม่ลง `device` table ของ Controller เครื่องนั้นทันที
- ตรวจชื่อว่างและชื่อซ้ำกับ Controller อื่นที่ยังใช้งานของ Member เดียวกัน
- ชื่อบน Controller เครื่องอื่นยังเป็นชื่อที่ได้จาก `device.link` ตอน Link; การซิงก์ชื่อข้ามเครื่องเป็นงานแยก

## Capabilities

### New Capabilities

- `device-names`: การเปลี่ยนชื่อ Controller ในเครื่องตัวเองหลัง Link

### Modified Capabilities

- ไม่มี

## Non-goals

- ส่ง `device.rename` certificate ผ่าน Hub เพื่อให้ทุกเครื่องเห็นชื่อใหม่ — ต้องมี protocol/schema และเป็นงานแยก
- เปลี่ยนชื่อ Member หรือชื่อ Machine
- เปลี่ยนชื่อ Controller ที่ถูก revoke แล้ว

## Impact

- **Controller:** `entities/device` เพิ่ม `renameDevice`, หน้า `pages/devices` เพิ่มช่องแก้ชื่อ, i18n th/en, test
- **Hub / Runtime / Protocol:** ไม่เปลี่ยน
- **Database:** ใช้ `device` table เดิม; ไม่มี migration

## Acceptance anchor cases

- เปลี่ยนชื่อ Controller ที่ยังใช้งานแล้วปิด/เปิดหน้าใหม่ ชื่อใหม่ยังอยู่
- ชื่อว่างหรือซ้ำกับ Controller อื่นที่ยังใช้งานถูกปฏิเสธ
- เปลี่ยนชื่อ Controller ที่ถูก revoke ไม่ได้
- Controller เครื่องอื่นยังเห็นชื่อเดิมจนกว่าจะมี change ซิงก์ชื่อ
