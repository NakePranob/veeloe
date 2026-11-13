## 1. Profile

- [x] 1.1 ไฟล์ `packaging/apparmor/veeloe-bwrap` + เนื้อหาฝังใน binary
- [x] 1.2 test ว่าเนื้อหามี `userns` และ path bwrap เท่านั้น

## 2. Doctor

- [x] 2.1 `veeloe doctor --fix-apparmor`: ตรวจ OS/root, เขียนไฟล์, โหลด, ตรวจผล
- [x] 2.2 ไม่ root/ไม่ใช่ Linux → ข้อความชัด ไม่แตะระบบ
- [x] 2.3 test ด้วย injectable writer/runner (ไม่ต้องมี AppArmor จริง)

## 3. Preflight

- [x] 3.1 ข้อความชี้คำสั่งใหม่ + test
- [ ] 3.2 ตรวจบน Ubuntu 24.04 restriction=1 (เหลือให้ CI/เครื่องจริง)

  ที่ทำได้แล้ว: parse profile ด้วย `apparmor_parser -Q` (4.0.1) ใน Ubuntu 24.04
  container ผ่าน; ที่ยังไม่ได้: `apparmor_parser -r` โหลดจริงและ
  `bwrap --unshare-user` บน kernel ที่ `kernel.apparmor_restrict_unprivileged_userns=1`
