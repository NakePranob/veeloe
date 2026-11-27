## 1. ADR

- [x] 1.1 เขียน ADR 0079 และใส่หมายเหตุใน ADR 0027 กับ `CONTEXT.md`

## 2. Protocol

- [x] 2.1 `allow` ใน Trigger, `allow`/`lastSkip` ใน `trigger.listed` และ event `approval.skipped` ทั้งฝั่ง Rust และ TypeScript; ตรวจด้วย vectors และ `bun run check:protocol`

## 3. Runtime

- [x] 3.1 `TriggerRun.attended`/`allow` และ `run_tool` ปฏิเสธนอก scope ในรอบที่ไม่มีคนเฝ้า; ตรวจด้วย test ใน `runtime-core/tests`
- [x] 3.2 quiet ไม่ได้หลัง `approval.skipped`; ตรวจด้วย test ใน `runtime-core/tests`
- [x] 3.3 proxy ปฏิเสธโดเมนทันทีในรอบที่ไม่มีคนเฝ้า; ตรวจด้วย unit test ใน `approval.rs`
- [x] 3.4 supervisor: Approve สำหรับ `allow`, รักษารอบเมื่อเวลาไม่เปลี่ยน, `last_skip`, ส่ง `attended`/`allow`; ตรวจด้วย `tests/triggers.rs`

## 4. Controller

- [x] 4.1 การ์ด Schedule แสดงรอบล่าสุดและ scope และลบรายการได้
- [x] 4.2 Task แสดง `approval.skipped` และปุ่มเพิ่มเข้า scope ทั้งบนรายการที่ถูกปฏิเสธและบน Approval
- [x] 4.3 คำทั้งไทยและอังกฤษ; ตรวจบน Simulator ทั้งสว่างและมืด

## 5. ตรวจ

- [x] 5.1 `bun run check`, `bun run test`, `bun run test:e2e`
