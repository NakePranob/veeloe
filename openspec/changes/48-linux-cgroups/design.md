## Context

- #47 มี `Limits { cpuSeconds, memoryMb }`, RLIMIT_CPU และ RSS watch ที่ใช้ `proc_pidinfo` (macOS)
- worker spawn อยู่ใน `workers::session` ผ่าน `Command`
- Linux runner ส่วนใหญ่ไม่มี user systemd; Docker ก็ไม่มี

## Decisions

**systemd-run scope:** ถ้ามี `systemd-run` และ `systemctl --user show-environment` ใช้ได้ ให้ห่อ argv ของ worker ด้วย `systemd-run --user --scope --quiet --collect -p MemoryMax=<MB>M -p CPUQuota=<percent>% -p TasksMax=<n> -- <worker argv>`; ถ้าไม่ ให้ใช้ argv เดิม
การตรวจทำครั้งเดียวต่อ supervisor (แคชไว้ใน `Workers`), ใช้ `spawn_blocking` จึงไม่ถ่วง supervisor ตอนเริ่ม และจำกัดเวลา 2 วินาทีต่อคำสั่ง; `systemd-run` เป็น scope จึงรันคำสั่งเองและ stdin/stdout ของ worker ยังเป็น pipe เดิม
เมื่อใช้ scope แล้ว process ที่ supervisor ถือคือ `systemd-run` ซึ่งมี worker อยู่ข้างใต้ `kill_tree` จึงต้องฆ่าทั้ง subtree (เดิม macOS เท่านั้น) ไม่งั้นการ Stop จะเหลือ worker ลอย

**ค่า config:** เพิ่ม `limits.tasks` (default 512) และ `limits.cpuPercent` (default 200) สำหรับ CPUQuota; `cpuSeconds` ยังใช้กับ RLIMIT_CPU เป็นเพดานเวลารวม

**fallback:** เมื่อ cgroup ใช้ไม่ได้ ให้ log `worker.cgroup_unavailable` ครั้งเดียวต่อ supervisor และใช้ RLIMIT_CPU + RSS watch ตามปกติ; RSS reader เลือกตาม OS (`proc_pidinfo` บน macOS, `/proc/<pid>/statm` × page size บน Linux พร้อม process tree จาก PPID ของทุก `/proc/<pid>/stat` — เลือกทางนี้แทน `/proc/<pid>/task/*/children` เพราะไม่ต้องพึ่ง CONFIG_PROC_CHILDREN) และอ่าน CPU time จาก `utime+stime` ของ `/proc/<pid>/stat` เพื่อให้แยก SIGKILL ที่มาจาก RLIMIT_CPU ได้เหมือน macOS

**fail behavior:** ถ้า systemd-run มีแต่ spawn ล้มเหลวเนื่องจาก cgroup ไม่พร้อม ให้ fallback โดยไม่ทำให้ worker ไม่เปิด และจำว่าเครื่องนี้ใช้ scope ไม่ได้ไปตลอด (ไม่ลองซ้ำทุก worker); ถ้า cgroup ตั้งได้แต่ worker ตายด้วย OOM ให้ log `worker.limit {limit:"memory"}` ผ่าน RSS/exit signal ตามที่มี

**config:** `limits.tasks` (default 512, 1..65536) และ `limits.cpuPercent` (default 200, 1..6400) ใช้ reader/validation ชุดเดียวกับ `cpuSeconds`/`memoryMb` — ค่าที่อ่านไม่ได้หรือเกินช่วงใช้ default และเขียน `limits.invalid {field}` ระดับ warn

## Risks

- CI ไม่มี user systemd จึงยืนยันได้เฉพาะ fallback; cgroup จริงต้องทดสอบบนเครื่อง Linux ที่มี systemd
- `systemd-run` ที่เปิด scope ไม่ได้จะทำให้ worker ตายทันทีโดยไม่ถูกจับเป็น "spawn ล้มเหลว" (spawn สำเร็จ แต่ process จบเร็ว) — ความเสี่ยงนี้ลดลงเพราะตรวจ `systemctl --user show-environment` ก่อน แต่ยังต้องดูบนเครื่องจริง
- `systemd-run` อาจคืน exit code แทน signal ของ worker (เช่น 137) ทำให้ `breach()` บน Linux ไม่ได้ชื่อ limit จาก signal; RSS watch ยังรายงาน memory limit ได้ตามปกติ
- CPUQuota เป็นอัตรา ไม่ใช่เวลารวม; ใช้คู่กับ RLIMIT_CPU
- cgroup ของ user อาจถูกจำกัดโดย administrator; ต้อง fallback ไม่ล้มทั้งระบบ
