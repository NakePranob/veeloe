## Context

supervisor เปิด worker ผ่าน `Command` ใน `workers::session`; ไม่มีการจำกัด resource เลย macOS ไม่มี cgroup; มี `libproc` ผ่าน libc ที่ใช้อยู่แล้ว

## Decisions

**RLIMIT_CPU:** ตั้งใน `pre_exec` ของ worker ด้วย `setrlimit(RLIMIT_CPU, soft, hard)`; soft = ค่า config, hard = soft + 60s เพื่อให้ SIGXCPU มาถึงและ process มีโอกาสจบ

**RSS monitor:** task ต่อ worker อ่าน RSS ด้วย `proc_pidinfo(PROC_PIDTASKINFO)` ทุก 2 วินาที รวม process ลูกทุกตัวของ worker เพราะคำสั่งของ Task เป็นคนกิน RAM จริง; เกิน `memoryMb` ติดกันหนึ่งครั้ง → `kill(pid, SIGKILL)` แล้วฆ่า process ลูกที่หาได้ผ่าน `proc_listchildpids`; บันทึก `worker.limit {agent, limit}` ระดับ warn (ไม่มีเนื้อหาหรือ path)

**การระบุสาเหตุ:** `SIGXCPU` คือ soft `RLIMIT_CPU` เสมอ; `SIGKILL` จะนับเป็น CPU limit ก็ต่อเมื่อ CPU time ที่อ่านได้ล่าสุด (`pti_total_user` + `pti_total_system` จาก task เดียวกับ RSS monitor) ถึง soft limit แล้ว ถ้ายังไม่ถึง (เช่นผู้ใช้ `kill -9` หรือ Jetsam) บันทึก `worker.limit {agent, signal}` โดยไม่ระบุ limit

**Config:** `limits: { cpuSeconds, memoryMb }` ใน `config.json`; default 1800s และ 4096 MB; ค่าที่อ่านไม่ได้หรือ <= 0 ใช้ default และ log เตือน

**Turn ที่ถูกตัด:** worker ตาย → supervisor เปิดใหม่; worker ใหม่ปิด Turn ที่ค้างเป็น `turn.interrupted` ตาม ADR 0033; ไม่มีโค้ดใหม่ใน worker

## Risks

- `RLIMIT_CPU` เป็น CPU time ไม่ใช่ wall clock → งานที่รอ I/O ไม่ถูกตัด (ตั้งใจ)
- `RLIMIT_CPU` เป็นต่อ process: คำสั่งลูกแต่ละตัวได้ budget ของตัวเอง ไม่ใช่ผลรวม; ตัวที่กิน CPU หลายตัวพร้อมกันจึงถูกจำกัดด้วย RSS monitor แทน
- RSS อ่านทุก 2 วิ อาจเห็นค่าหลังเกินไปเล็กน้อย → เลือก threshold ที่ปลอดภัย
- process tree ที่ `kill_tree` เห็นเป็น snapshot: หลานที่เกิดหลัง snapshot อาจรอด และ pid ใน snapshot อาจถูก reuse ก่อน kill (best effort); RSS เกินหนึ่งครั้งตัดทันทีโดยไม่รอ sample ที่สอง (ยอมรับแล้ว)
- macOS เท่านั้น; Linux ต้องรอ cgroup
