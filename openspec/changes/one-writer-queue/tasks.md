## 1. Controller

- [x] 1.1 ลบเงื่อนไข `busy` ออกจาก `send()` และปุ่ม Send ใน `TaskPage`; ให้ส่งข้อความเข้าคิวได้
- [x] 1.2 เปลี่ยน placeholder ขณะ busy เป็นข้อความว่า Turn กำลังทำงานและข้อความจะรอ
- [x] 1.3 เพิ่มคำแปล th/en `queued`
- [ ] 1.4 เพิ่ม event/queue position `task.queued` และแสดงลำดับคิว (งานถัดไป)

## 2. ตรวจ

- [ ] 2.1 `cd controller && bun test ./src`
- [ ] 2.2 `bun run check:controller`
- [ ] 2.3 QA: ใช้ mock Provider ตอบช้า ส่งข้อความที่สองขณะ Turn กำลังทำ แล้วตรวจว่าข้อความที่สองถูกประมวลผลหลัง Turn แรก
