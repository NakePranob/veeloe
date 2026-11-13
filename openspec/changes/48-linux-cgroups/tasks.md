## 1. Config

- [ ] 1.1 เพิ่ม `limits.tasks` และ `limits.cpuPercent` พร้อม default/validation
- [ ] 1.2 test ค่า default/ผิด

## 2. Linux cgroup

- [ ] 2.1 ตรวจ systemd user session และสร้าง argv systemd-run
- [ ] 2.2 spawn worker ผ่าน scope; ถ้าไม่ได้ ใช้ fallback + log ครั้งเดียว
- [ ] 2.3 RSS reader บน Linux จาก /proc
- [ ] 2.4 test argv/fallback/RSS (fake) และ CI Linux

## 3. ตรวจ

- [ ] 3.1 cargo test workspace + CI ผ่าน
