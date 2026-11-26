## 1. Egress ต่อ Agent

- [x] 1.1 Agent เก็บ Egress ของตัวเอง (`agents.json`); migrate รายชื่อ Machine เดิมให้ทุก Agent ครั้งเดียวด้วย `runtime/egress.json.migrated` และคง `egress.json` เป็นมุมมองรวม
- [x] 1.2 `egress.set` ระบุ Agent และตรวจสิทธิ์ Manage (v0.1: ต้องเป็น Owner ที่กุญแจเซ็น); แบบไม่ระบุยังมีผลทุก Agent
- [x] 1.3 `agent.listed` บอก Egress ต่อ Agent และ `egress` รวมแบบเดิม
- [x] 1.4 test: Egress ต่างกันต่อ Agent, migration ครั้งเดียว, ปฏิเสธเมื่อไม่มีสิทธิ์ (`tests/egress.rs`, `tests/agent_slices.rs`)

## 2. proxy ต่อ Agent

- [x] 2.1 proxy เปิด listener ต่อ Agent (TCP บน macOS, Unix socket ต่อ Agent บน Linux) และ worker ใช้ของตัวเองเท่านั้น
- [x] 2.2 profile/policy เปิดเฉพาะ port/socket ของ Agent นั้น; toolchain check ใช้ชุดเดียวกัน
- [x] 2.3 test: proxy ของ A ไม่รับโดเมนของ B และกลับกัน (unit), e2e: A ถึงโดเมนที่ B ไม่ถึง; macOS ผ่าน, Linux รอ CI

## 3. ตรวจ

- [x] 3.1 `cargo test --workspace -- --test-threads=1` ผ่านบน macOS
- [x] 3.2 Linux CI ผ่าน — privileged Ubuntu 24.04 (Docker) ผ่าน และ CI `Runtime and Protocol (Rust)` เขียว
- [x] 3.3 e2e ผ่านทั้งสองระบบ — macOS 16/16 และ CI job `e2e` บน Linux เขียว
