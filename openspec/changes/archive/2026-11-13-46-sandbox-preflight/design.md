## Decisions

**Probe แยกจาก OS:** ฟังก์ชัน `preflight(probe)` รับ struct ที่บอกว่ามี binary ไหมและอ่านไฟล์ sysctl ได้ ทำให้ test จำลองเครื่องที่ขาดได้โดยไม่ต้องรัน Linux

**ข้อความ Linux:** ถ้าไม่มี `bwrap` → บอกคำสั่งติดตั้งตาม distro; ถ้า `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` เป็น 1 → บอกว่าต้องเพิ่ม AppArmor profile ให้ `bwrap` (ไม่แนะนำปิดทั้งเครื่อง); ถ้า `/proc/sys/kernel/unprivileged_userns_clone` เป็น 0 → บอกค่าที่ต้องเปิด

**macOS:** ตรวจ `/usr/bin/sandbox-exec` ว่าเป็นไฟล์ที่รันได้

**จุดเรียก:** ก่อนเปิด Hub link และ Workers; โหมด `worker` ไม่ตรวจซ้ำ (อยู่ใน sandbox แล้ว)

## Risks

- ข้อความอาจล้าสมัยตาม distro → เก็บไว้ที่เดียวและอ้างไฟล์/ค่า ไม่เดา distro
