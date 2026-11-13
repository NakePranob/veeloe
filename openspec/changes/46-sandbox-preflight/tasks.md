# Tasks

## 1. Preflight

- [x] 1.1 probe ที่ฉีดได้: มี bwrap ไหม, ค่า userns restriction, มี sandbox-exec ไหม
- [x] 1.2 ข้อความ Linux: ขาด bwrap / userns ถูกปิด พร้อมคำสั่งหรือไฟล์ที่ต้องแก้
- [x] 1.3 ข้อความ macOS: ขาด sandbox-exec
- [x] 1.4 supervisor เรียกก่อนเริ่มและ exit code ไม่ใช่ 0
- [x] 1.5 test ด้วย probe ปลอมทั้งสามกรณีและกรณีพร้อม

## 2. ที่ยังต้องยืนยัน

- [ ] 2.1 CI Linux: กรณี bwrap ขาด / AppArmor ถูกจำกัด / clone sysctl เป็น 0 ตรวจด้วย
      probe ปลอมบน macOS แล้ว แต่รอบนี้ยังไม่ได้รัน `veeloe` บน Linux จริง
- [ ] 2.2 AppArmor profile ของ Veeloe เอง (ไฟล์และตัวติดตั้ง) ยังไม่อยู่ในรอบนี้:
      ข้อความอ้าง profile ที่ Ubuntu มีให้ (`bwrap-userns-restrict`) ตาม ADR 0069
