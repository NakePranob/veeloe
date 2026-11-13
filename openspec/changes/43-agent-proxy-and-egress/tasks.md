## 1. Egress ต่อ Agent

- [ ] 1.1 Agent เก็บ Egress ของตัวเอง; migrate รายชื่อ Machine เดิมให้ทุก Agent ครั้งเดียว
- [ ] 1.2 `egress.set` ระบุ Agent และตรวจสิทธิ์ Manage; แบบไม่ระบุยังมีผลทุก Agent
- [ ] 1.3 `agent.listed` บอก Egress ต่อ Agent และ `egress` รวมแบบเดิม
- [ ] 1.4 test: Egress ต่างกันต่อ Agent, migration, ปฏิเสธเมื่อไม่มีสิทธิ์

## 2. proxy ต่อ Agent

- [ ] 2.1 proxy เปิด listener ต่อ Agent (TCP บน macOS, Unix socket บน Linux) และ worker ใช้ของตัวเองเท่านั้น
- [ ] 2.2 profile/policy เปิดเฉพาะ port/socket ของ Agent นั้น; toolchain check ใช้ชุดเดียวกัน
- [ ] 2.3 test: Agent A ต่อโดเมนของ B ไม่ได้, proxy ของ A ไม่รับงานแทน B, macOS + Linux

## 3. ตรวจ

- [ ] 3.1 `cargo test --workspace -- --test-threads=1` ผ่านบน macOS
- [ ] 3.2 Linux CI ผ่าน
- [ ] 3.3 e2e ผ่านทั้งสองระบบ
