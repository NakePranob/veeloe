## Why

issue #47 (story 36 ของ #32): บน macOS worker ที่กิน CPU หรือ RAM เกินสามารถทำให้เครื่องทั้งเครื่องหนืด และยังไม่มีอะไรตัดมัน

## What Changes

- worker ของ Agent บน macOS ถูกตั้ง `RLIMIT_CPU` (soft/hard) จาก config
- supervisor เฝ้า RSS ของ worker เป็นระยะ เกินกำหนดแล้วฆ่าและบันทึก Runtime log ว่า Agent ไหนชน limit ใด
- ค่า limit มี default และตั้งได้ใน `config.json`
- Turn ที่ถูกตัดจบตามกลไก interrupted/error เดิม

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: การจำกัด CPU time และหน่วยความจำของ worker บน macOS

## Impact

- runtime-supervisor: config, worker spawn (RLIMIT), monitor, log
- test: config, RSS reader ปลอม, การตัดจริงเท่าที่ CI ทำได้
- Linux ยังไม่เปลี่ยน (cgroup เป็น ticket ถัดไป)
