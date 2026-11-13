## 1. ช่วง port ของ Agent บน macOS

- [x] 1.1 supervisor จอง 10 port ต่อ Agent จากช่วง 20000–60000, ไม่ทับช่วงที่จองแล้วและไม่ทับ port ของ proxy, เก็บใน `<VEELOE_HOME>/runtime/ports.json` และคืนค่าเดิมเมื่อเปิด worker ใหม่
- [x] 1.2 ส่ง `PORT` (port แรก) และ `VEELOE_PORTS` (รายการคั่น comma) ให้ worker และคำสั่ง
- [x] 1.3 profile ของ macOS เปิด `network-inbound`/`network-outbound` เฉพาะ port ในช่วงของ Agent บวก port ของ proxy และยังปฏิเสธ port อื่น
- [x] 1.4 test: สอง Agent ได้ช่วงต่างกัน, ช่วงเดิมหลัง restart, bind/connect port ตัวเองได้, ต่อ service ของ host นอกช่วงไม่ได้

## 2. ทางออกเน็ตบน Linux

- [x] 2.1 proxy เปิด Unix listener ที่ `<VEELOE_HOME>/runtime/egress.sock` ใช้ตัวจัดการ/ตรวจ Egress ชุดเดียวกับ TCP
- [x] 2.2 `bwrap` bind Unix socket เข้า namespace ที่ path คงที่และสร้าง parent dir ให้
- [x] 2.3 worker เปิด TCP bridge บน loopback ใน namespace ไป Unix socket และตั้ง `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` ให้คำสั่ง; ถ้า bridge เปิดไม่ได้ worker ไม่พร้อมรับงานและรายงาน
- [x] 2.4 test: คำสั่งใน namespace ต่อ `example.com` ผ่าน proxy ได้เมื่ออยู่ใน Egress, ออกตรงไม่ได้เมื่อ Egress ว่าง, loopback ของตัวเองใช้ได้, สอง Agent ใช้ port เดียวกันได้
- [x] 2.5 e2e เคส Egress เอา skip macOS-only ออกและผ่านบน Linux

## 3. ตรวจทั้งระบบ

- [ ] 3.1 `cargo test --workspace -- --test-threads=1` ผ่านบน macOS
- [ ] 3.2 test ที่มี `cfg(linux)` และ CI job `Runtime and Protocol (Rust)` ผ่านบน Linux
- [ ] 3.3 `bun test` (e2e) ผ่านทั้ง macOS และ Linux
- [ ] 3.4 ตรวจ manual ด้วย dev stack: Agent รัน dev server บน `PORT`, ต่อ `localhost`, และ `curl` โดเมนใน Egress
