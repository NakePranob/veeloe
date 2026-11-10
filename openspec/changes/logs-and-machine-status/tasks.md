## 1. Runtime logs

- [x] 1.1 เพิ่ม `logs.rs`: `record(home, level, event, fields)`, `record_at` สำหรับ test, `recent(home)`, `purge(home, keep=14)`; เขียน JSON lines ที่ `<home>/runtime/logs/<day>.log`
- [x] 1.2 เพิ่ม `veeloe logs [--follow]` ใน CLI/help; อ่านไฟล์เรียงวันและ tail เมื่อ follow
- [ ] 1.3 เรียก `record` ที่จุดสำคัญ: start, hub connected, pair, agent create/update/delete, task message (เฉพาะ id/agent/task/turn), turn done/error, provider error; ห้ามใส่ข้อความหรือชื่อไฟล์
- [x] 1.4 เพิ่ม test ว่า log มีเฉพาะ field ที่อนุญาต, rotation ลบไฟล์เก่า, `recent` เรียงวัน, และไม่มี content จาก task

## 2. Machine status

- [x] 2.1 เพิ่ม protocol `machine.status` body `{version, features, lastError, diskFreeBytes, budgetToday}`; Runtime ตอบเมื่อ Controller ขอ
- [x] 2.2 Controller เก็บสถานะและแสดงการ์ดในหน้า Machine: version, features, disk, budget, last error
- [x] 2.3 เพิ่ม test ว่า Runtime ส่ง status หลัง ready และ Controller แสดงค่าที่ได้รับ

## 3. ตรวจ

- [x] 3.1 `cd packages/runtime && cargo test -p veeloe-runtime-supervisor`
- [x] 3.2 `bun run check:protocol`
- [x] 3.3 `cd controller && bun test ./src`
- [x] 3.4 `bun run check:controller`
- [x] 3.5 รัน `./dist/veeloe logs` และ `--follow` บนเครื่องจริง
