## 1. Preflight

- [ ] 1.1 probe ที่ฉีดได้: มี bwrap ไหม, ค่า userns restriction, มี sandbox-exec ไหม
- [ ] 1.2 ข้อความ Linux: ขาด bwrap / userns ถูกปิด พร้อมคำสั่งหรือไฟล์ที่ต้องแก้
- [ ] 1.3 ข้อความ macOS: ขาด sandbox-exec
- [ ] 1.4 supervisor เรียกก่อนเริ่มและ exit code ไม่ใช่ 0
- [ ] 1.5 test ด้วย probe ปลอมทั้งสามกรณีและกรณีพร้อม
