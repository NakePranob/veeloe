## 1. Config

- [x] 1.1 เพิ่ม `limits.tasks` และ `limits.cpuPercent` พร้อม default/validation
- [x] 1.2 test ค่า default/ผิด

## 2. Linux cgroup

- [x] 2.1 ตรวจ systemd user session และสร้าง argv systemd-run
- [x] 2.2 spawn worker ผ่าน scope; ถ้าไม่ได้ ใช้ fallback + log ครั้งเดียว
- [x] 2.3 RSS reader บน Linux จาก /proc
- [x] 2.4 test argv/fallback/RSS (fake) และ CI Linux

## 3. ตรวจ

- [x] 3.1 cargo test workspace + CI ผ่าน

## หมายเหตุการตรวจ (2026-11-13)

- macOS: `cargo check --workspace`, `cargo test --workspace -- --test-threads=1` ผ่านทั้งชุด; unit test ของ `cgroup`/`limits`/`workers` ผ่าน
- Linux (Ubuntu 24.04, privileged Docker, ไม่มี systemd ใน image): `cargo check --workspace` ผ่าน, `cargo test -p veeloe-runtime-supervisor --lib` ผ่าน 79 test และ test fallback (`without_a_cgroup_every_worker_runs_and_the_fallback_is_said_once`) ผ่าน — ยืนยัน fallback, log ครั้งเดียว, และ /proc reader บน kernel จริง
- ยังไม่ได้พิสูจน์: การเปิด scope จริง (`systemd-run --user --scope`) เพราะ container ไม่มี user systemd; ต้องรันบนเครื่อง Linux ที่มี systemd user session — test `cgroup::tests::a_real_scope_starts_a_command_when_the_machine_has_one` จะทำงานเองเมื่อ `detect()` เป็นจริง
- ยังไม่ได้รัน integration test ชุด `workers` ทั้งไฟล์บน Linux เพราะต้องมี AppArmor profile ของ bwrap (ticket แยก)
