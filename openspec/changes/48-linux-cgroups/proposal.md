## Why

issue #48 (story 35 ของ #32): บน Linux ยังไม่มีอะไรจำกัด memory/CPU/process ของ worker; Agent ตัวเดียวสามารถทำให้เครื่องหนืดหรือ OOM ได้

## What Changes

- worker บน Linux ถูกเปิดผ่าน `systemd-run --user --scope` พร้อม `MemoryMax`, `CPUQuota`, `TasksMax` จาก config
- ถ้าไม่มี systemd user session หรือคำสั่งล้มเหลว ใช้ fallback: RLIMIT_CPU + RSS watch (ขยายจาก #47 ให้อ่าน /proc)
- config เพิ่ม `limits.tasks` และค่า default; ค่าผิด fallback
- log `worker.cgroup_unavailable` ครั้งเดียวเมื่อใช้ fallback

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: การจำกัด resource ของ worker บน Linux

## Impact

- runtime-supervisor: limits config, worker spawn, systemd-run argv, RSS reader ต่อ OS
- test: argv/fallback/RSS; CI Linux
- ไม่แตะ AppArmor (ticket แยก)
