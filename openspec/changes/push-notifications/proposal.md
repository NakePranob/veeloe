## Why

Member สั่ง Agent แล้ววางมือถือไว้ ไม่รู้ว่า Approval รออยู่หรือ Turn จบแล้วหรือยัง เพราะ Controller ต่อ Hub อยู่เบื้องหลังและไม่มีอะไรเรียกความสนใจเมื่อแอปไม่ได้เปิดอยู่ ADR 0044 จึงกำหนดให้ push ไปหาเฉพาะคนที่เรื่องนั้นรออยู่หรือเป็นเรื่องของเขา และให้ Runtime เป็นคนเลือกผู้รับจาก Grant

## What Changes

- Controller ขออนุญาตแจ้งเตือน สร้าง Expo Push Token และส่ง `push.register` ที่เซ็นแล้วไปยัง Machine พร้อมภาษาของเครื่อง
- Runtime เก็บ token ต่อ Member ต่อ Controller และลบเมื่อเครื่องนั้นถูกถอนกุญแจ
- Runtime ส่ง push ผ่าน Expo Push Service เมื่อมี Approval รออยู่ และเมื่อ Turn ที่ Member นั้นเริ่มจบลง
- เนื้อหา push เป็นข้อความกลางๆ ไม่มีข้อความ Task ชื่อไฟล์ หรือชื่อ Agent; `data` มีเฉพาะรหัสที่ใช้เปิดหน้า
- Controller ไม่แสดง banner ซ้ำเมื่อกำลังเปิด Task นั้นอยู่ และกด push แล้วเปิด Task ที่ถูกต้อง
- ลบ token ที่ Expo ตอบ `DeviceNotRegistered`

## Capabilities

### New Capabilities

- `push-notifications`: การลงทะเบียน token และการส่ง push ตาม Grant

### Modified Capabilities

- `runtime-tasks`: Approval และ Turn ที่จบลงมี push ไปยังผู้รับที่กำหนด
- `controller-tasks`: Controller ลงทะเบียน token และเปิด Task จาก push

## Non-goals

- Budget, Mention, Schedule, Idle Work, Watch, Connector login และ Linking (รอบถัดไป)
- ปุ่ม Approve/Deny บน notification; Approval ต้องปลดล็อกและยืนยันตัวในแอปตาม ADR 0012
- เนื้อหา Task ใน push ก่อนมี E2E (ADR 0005)
- APNs/FCM ตรง; รอบนี้ใช้ Expo Push Service
- การปิด push เฉพาะ Agent; รอบนี้เปิด/ปิดทั้งเครื่อง
- Rich notification, image, action button และ notification service extension

## Impact

- **Protocol:** `push.register`, `push.unregister`
- **Runtime:** token store, Expo Push client, trigger ที่ Approval และ Turn จบ
- **Controller:** `expo-notifications`, permission, token refresh, deep link
- **Hub:** ไม่เปลี่ยน; ยังส่งต่อซองเท่านั้นและไม่เก็บ token หรือเนื้อหา
- **Credentials:** Expo project ID และ push credentials สำหรับ QA บนเครื่องจริง

## Acceptance anchor cases

- Member อนุญาต notification แล้ว token ไปถึง Machine ที่ผูกอยู่
- Approval ใหม่สร้าง push ถึง Member ที่มี Approve ที่ Agent
- Turn จบสร้าง push ถึง Member ที่เริ่ม Turn เท่านั้น
- Member คนอื่นไม่ได้รับ push ของ Task ที่ไม่ใช่ของตน
- เนื้อหา push ไม่มีข้อความ Task ชื่อไฟล์ หรือชื่อ Agent
- ปิด notification ในแอปแล้วไม่มีการส่ง push ในรอบถัดไป
- ถอนกุญแจ Controller แล้ว token ของเครื่องนั้นถูกใช้ไม่ได้

## Decisions needed before implementation

ไม่มี; เลือก Expo Push Service ตาม ADR 0044 และข้อจำกัดค่าใช้จ่ายแล้ว เหลือเพียง Expo project ID และ credentials สำหรับ QA เครื่องจริง
