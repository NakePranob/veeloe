## ADDED Requirements

### Requirement: Veeloe ติดตั้ง AppArmor profile สำหรับ bwrap ได้
บน Linux ที่ใช้ AppArmor จำกัด unprivileged user namespaces Veeloe SHALL มีคำสั่งที่ติดตั้ง profile ซึ่งอนุญาต `userns` เฉพาะ `/usr/bin/bwrap` โดยไม่เปลี่ยน `kernel.apparmor_restrict_unprivileged_userns` ทั้งเครื่อง คำสั่ง SHALL ต้องรันด้วยสิทธิ์ root และ MUST NOT เขียนไฟล์หรือเปลี่ยนระบบเมื่อสิทธิ์ไม่พอ คำสั่ง SHALL ตรวจผลหลังโหลดและรายงานว่า sandbox ใช้ได้หรือไม่ บนระบบที่ไม่มี AppArmor คำสั่ง SHALL บอกว่าไม่ต้องใช้และไม่ทำอะไร ข้อความ preflight SHALL ชี้ให้ผู้ใช้ใช้คำสั่งนี้

#### Scenario: ติดตั้งสำเร็จ
- **WHEN** ผู้ใช้รันคำสั่งด้วย root บน Ubuntu 24.04 ที่ restriction=1
- **THEN** profile ถูกติดตั้งและโหลด และ bwrap สร้าง user namespace ได้

#### Scenario: ไม่มีสิทธิ์
- **WHEN** ผู้ใช้รันคำสั่งโดยไม่ใช่ root
- **THEN** ได้ข้อความบอกให้ใช้ sudo และไม่มีไฟล์ถูกเขียน

#### Scenario: ระบบอื่น
- **WHEN** รันบน macOS หรือระบบที่ไม่มี AppArmor
- **THEN** บอกว่าไม่ต้องใช้ และไม่เปลี่ยนอะไร
