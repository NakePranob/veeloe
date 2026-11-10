## 1. Runtime

- [x] 1.1 เพิ่ม `runtime-supervisor/src/service.rs` ที่มี `install(home)`, `uninstall(home)`, `launchd_plist(exe, home, log)`, `systemd_unit(exe, home)`; แยกการเขียนไฟล์/เรียก OS command จาก pure renderer เพื่อ test ได้
- [x] 1.2 เพิ่ม CLI `service install|uninstall` ใน `main.rs` และ help; ตรวจ `trust.owners` ไม่ว่างก่อน install
- [x] 1.3 บน macOS ใช้ `launchctl bootout gui/$UID/dev.veeloe.runtime` (ไม่สนใจ error) แล้ว `launchctl bootstrap gui/$UID <plist>`; บน Linux ใช้ `systemctl --user daemon-reload` และ `systemctl --user enable --now veeloe.service`
- [x] 1.4 สร้าง `<home>/runtime/logs/` และให้ stdout/stderr ไปที่ `service.log`; uninstall ลบ unit/plist แต่ไม่แตะข้อมูล Agent
- [x] 1.5 เพิ่ม test ของ plist/unit ว่ามี executable, `VEELOE_HOME`, log path และ label/unit name; test ว่า install ปฏิเสธเครื่องที่ยังไม่ pair

## 2. ตรวจ

- [x] 2.1 `cd packages/runtime && cargo test -p veeloe-runtime-supervisor`
- [ ] 2.2 `./dist/veeloe service install` บน macOS ที่ pair แล้ว; ปิด terminal แล้ว Runtime ยังทำงาน
- [ ] 2.3 `./dist/veeloe service uninstall` แล้ว process หยุดและ plist/unit หาย
