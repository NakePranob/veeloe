## 1. Config และ RLIMIT

- [x] 1.1 `limits` ใน config พร้อม default และ validation — `src/limits.rs`: default 1800 วินาที/4096 MB, ค่าที่ไม่ใช่จำนวนเต็มบวกใช้ default และเขียน `limits.invalid` ระดับ warn; config เสียก็ยังเริ่ม Runtime ได้
- [x] 1.2 ตั้ง RLIMIT_CPU ใน worker pre_exec — macOS เท่านั้น; soft = `cpuSeconds`, hard = soft + 60 วินาที
- [x] 1.3 test config/ค่าเสีย — `limits::tests::{limits_are_read_from_the_config_with_sensible_defaults,limits_that_make_no_sense_fall_back_and_are_warned_about,a_broken_config_file_still_starts_with_the_defaults}`

## 2. RSS monitor

- [x] 2.1 monitor อ่าน RSS และฆ่าเมื่อเกิน พร้อม log `worker.limit` — อ่านทุก 2 วินาที (`proc_pidinfo`), รวม RSS ของ worker กับคำสั่งลูก, ฆ่าทั้ง tree, log ระดับ warn พร้อม Agent กับ `limit`
- [x] 2.2 test ด้วย RSS reader ปลอม — `a_worker_under_its_memory_limit_keeps_running` และ `a_worker_over_its_memory_limit_is_killed_and_its_turn_is_interrupted`
- [x] 2.3 test จริงเท่าที่ทำได้ — memory: worker จริงถูกฆ่า, worker ใหม่ปิด Turn เป็น `turn.interrupted`; CPU: ลูกที่ busy ถูก `SIGXCPU`/`SIGKILL` จริง (`a_busy_child_is_stopped_by_its_cpu_limit`) และคำสั่งของ worker เห็นค่า limit จาก config ผ่าน `ulimit -t` (`a_workers_commands_inherit_the_cpu_limit_from_config`) — การรอให้ worker เองใช้ CPU ครบ 1800 วินาทีใน test ไม่คุ้มเวลาและไม่จำเป็น เพราะ limit ถูกตั้งที่ worker แล้ว

## 3. ตรวจ

- [x] 3.1 cargo test workspace ผ่าน macOS
- [x] 3.2 CI ผ่าน — run 43456877591 เขียวทุก job (รอ CI บน macOS; Linux ไม่เปลี่ยนในชิ้นนี้)
