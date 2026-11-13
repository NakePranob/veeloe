## Context

- #47 มี `Limits { cpuSeconds, memoryMb }`, RLIMIT_CPU และ RSS watch ที่ใช้ `proc_pidinfo` (macOS)
- worker spawn อยู่ใน `workers::session` ผ่าน `Command`
- Linux runner ส่วนใหญ่ไม่มี user systemd; Docker ก็ไม่มี

## Decisions

**systemd-run scope:** ถ้ามี `systemd-run` และ `systemctl --user show-environment` ใช้ได้ ให้ห่อ argv ของ worker ด้วย `systemd-run --user --scope --quiet --collect -p MemoryMax=<MB>M -p CPUQuota=<percent>% -p TasksMax=<n> -- <worker argv>`; ถ้าไม่ ให้ใช้ argv เดิม

**ค่า config:** เพิ่ม `limits.tasks` (default 512) และ `limits.cpuPercent` (default 200) สำหรับ CPUQuota; `cpuSeconds` ยังใช้กับ RLIMIT_CPU เป็นเพดานเวลารวม

**fallback:** เมื่อ cgroup ใช้ไม่ได้ ให้ log `worker.cgroup_unavailable` ครั้งเดียวต่อ supervisor และใช้ RLIMIT_CPU + RSS watch ตามปกติ; RSS reader เลือกตาม OS (`proc_pidinfo` บน macOS, `/proc/<pid>/statm` + `/proc/<pid>/task` บน Linux)

**fail behavior:** ถ้า systemd-run มีแต่ spawn ล้มเหลวเนื่องจาก cgroup ไม่พร้อม ให้ fallback โดยไม่ทำให้ worker ไม่เปิด; ถ้า cgroup ตั้งได้แต่ worker ตายด้วย OOM ให้ log `worker.limit {limit:"memory"}` ผ่าน RSS/exit signal ตามที่มี

## Risks

- CI ไม่มี user systemd จึงยืนยันได้เฉพาะ fallback; cgroup จริงต้องทดสอบบนเครื่อง Linux ที่มี systemd
- CPUQuota เป็นอัตรา ไม่ใช่เวลารวม; ใช้คู่กับ RLIMIT_CPU
- cgroup ของ user อาจถูกจำกัดโดย administrator; ต้อง fallback ไม่ล้มทั้งระบบ
