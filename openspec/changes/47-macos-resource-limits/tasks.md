## 1. Config และ RLIMIT

- [ ] 1.1 `limits` ใน config พร้อม default และ validation
- [ ] 1.2 ตั้ง RLIMIT_CPU ใน worker pre_exec
- [ ] 1.3 test config/ค่าเสีย

## 2. RSS monitor

- [ ] 2.1 monitor อ่าน RSS และฆ่าเมื่อเกิน พร้อม log `worker.limit`
- [ ] 2.2 test ด้วย RSS reader ปลอม (ไม่ต้องกิน RAM จริง)
- [ ] 2.3 test จริงเท่าที่ทำได้: worker/process ถูกตัดและ Turn จบ

## 3. ตรวจ

- [ ] 3.1 cargo test workspace ผ่าน macOS
- [ ] 3.2 CI ผ่าน
