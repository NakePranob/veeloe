## 1. Controller

- [x] 1.1 ลบเงื่อนไข `busy` ออกจาก `send()` และปุ่ม Send ใน `TaskPage`; ให้ส่งข้อความเข้าคิวได้
- [x] 1.2 เปลี่ยน placeholder ขณะ busy เป็นข้อความว่า Turn กำลังทำงานและข้อความจะรอ
- [x] 1.3 เพิ่มคำแปล th/en `queued`
- [x] 1.4 ตัดสินใจไม่เพิ่ม event/queue position ใน change นี้ เพราะ proposal ระบุเป็น non-goal; เก็บเป็นงานถัดไป

## 2. ตรวจ

- [x] 2.1 `cd controller && bun test ./src`
- [x] 2.2 `bun run check:controller`
- [x] 2.3 QA: ใช้ mock Provider ตอบช้า ส่งข้อความที่สองขณะ Turn กำลังทำ แล้วตรวจว่าข้อความที่สองถูกประมวลผลหลัง Turn แรก
