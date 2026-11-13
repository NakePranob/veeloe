## Context

- preflight (#46) อ่าน `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` และบอกให้ใช้ `bwrap-userns-restrict` ของ Ubuntu
- release ของ Veeloe เป็น binary เดียว; ผู้ใช้ไม่มี repo/ไฟล์ packaging

## Decisions

**Profile ของเราเอง:** `profile veeloe-bwrap /usr/bin/bwrap flags=(unconfined) { userns, }` พร้อม abi/tunables; เก็บไฟล์จริงที่ `packaging/apparmor/veeloe-bwrap` และฝังข้อความเดียวกันใน binary เพื่อให้ release ใช้ได้โดยไม่ต้องมี repo

**คำสั่ง:** `sudo veeloe doctor --fix-apparmor` เขียน `/etc/apparmor.d/veeloe-bwrap` (0644) แล้วรัน `apparmor_parser -r`; ตรวจผลด้วยการลอง `bwrap --unshare-user -- /bin/true`; ถ้าไม่ root → error ชัดและไม่แตะไฟล์; ถ้าไม่มี AppArmor → บอกว่าไม่ต้องใช้

**Preflight:** เปลี่ยนข้อความให้ชี้ `sudo veeloe doctor --fix-apparmor` เป็นทางหลัก และคง sysctl value ไว้เป็นข้อมูล

**ความปลอดภัย:** profile อนุญาตเฉพาะ bwrap; ไม่แตะ sysctl; ไม่เขียนทับ profile ชื่ออื่น; ไฟล์เขียนแบบ atomic

## Risks

- AppArmor profile syntax ต่างตามรุ่น; ต้องทดสอบบน Ubuntu 24.04 จริง (ยังไม่มีเครื่องในรอบนี้)
- ผู้ใช้ที่ติดตั้ง Veeloe แบบไม่ใช้ root ต้องรันคำสั่งด้วย sudo เอง
