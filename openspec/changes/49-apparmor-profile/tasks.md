## 1. Profile

- [ ] 1.1 ไฟล์ `packaging/apparmor/veeloe-bwrap` + เนื้อหาฝังใน binary
- [ ] 1.2 test ว่าเนื้อหามี `userns` และ path bwrap เท่านั้น

## 2. Doctor

- [ ] 2.1 `veeloe doctor --fix-apparmor`: ตรวจ OS/root, เขียนไฟล์, โหลด, ตรวจผล
- [ ] 2.2 ไม่ root/ไม่ใช่ Linux → ข้อความชัด ไม่แตะระบบ
- [ ] 2.3 test ด้วย injectable writer/runner (ไม่ต้องมี AppArmor จริง)

## 3. Preflight

- [ ] 3.1 ข้อความชี้คำสั่งใหม่ + test
- [ ] 3.2 ตรวจบน Ubuntu 24.04 restriction=1 (เหลือให้ CI/เครื่องจริง)
