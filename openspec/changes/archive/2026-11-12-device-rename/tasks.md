## 1. Controller

- [x] 1.1 เพิ่ม `renameDevice(database, key, name)` ใน `controller/src/entities/device/model/devices.ts` ที่อัปเดต `device.name` เฉพาะ row ที่ยังไม่ revoke และคืน `true/false`; เขียน test ว่า rename ได้, row ที่ revoke แล้วไม่เปลี่ยน, และชื่อถูกอ่านกลับ
- [x] 1.2 เพิ่มช่องแก้ชื่อใน `DeviceRow` ของ `controller/src/pages/devices/ui/DevicesPage.tsx` โดยใช้ `Field` และ `nameProblem`; แสดงปุ่ม Save/Cancel, ข้อความชื่อว่าง/ซ้ำ, และไม่แสดงสำหรับ row ที่ revoke แล้ว
- [x] 1.3 เพิ่มคำแปล th/en ใน `controller/src/pages/devices/i18n/` สำหรับ rename, save, cancel, empty, taken, failed
- [x] 1.4 เพิ่ม footer ว่าชื่อนี้เป็นชื่อบนเครื่องนี้; เครื่องอื่นยังเห็นชื่อเดิมจนกว่าจะมี change ซิงก์ชื่อ

## 2. ตรวจ

- [x] 2.1 `cd controller && bun test ./src`
- [x] 2.2 `bun run check:controller`
- [x] 2.3 เปิดหน้า My devices บน iOS/Android แล้ว rename จริงหนึ่งครั้ง; ปิดเปิดหน้าใหม่แล้วชื่อยังอยู่
