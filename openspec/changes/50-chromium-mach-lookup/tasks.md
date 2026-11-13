## 1. วัด service

- [ ] 1.1 รัน Chrome/Chromium headless ใน sandbox และเก็บ `sandbox.denied`
- [ ] 1.2 เพิ่ม service ที่จำเป็นพร้อม Reason::Browser และคอมเมนต์
- [ ] 1.3 รันซ้ำจนเปิดหน้า/print DOM ได้โดยไม่มี denial ที่จำเป็น

## 2. Test และเอกสาร

- [ ] 2.1 test macOS-only เปิด browser จริง (skip ถ้าไม่มี) และตรวจ DOM/ภาพ
- [ ] 2.2 อัปเดต ADR/ข้อความที่บอกว่า Chromium ยังไม่อยู่
- [ ] 2.3 cargo test + CI ผ่าน
