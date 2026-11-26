## Why

เมื่อ Agent ค้างหรือ Provider ตอบ error เจ้าของเครื่องต้องมีข้อมูลให้ดู แต่ Hub อ่านเนื้อหาไม่ได้จนกว่าจะมี E2E และ Runtime ไม่ควรส่งข้อความหรือไฟล์ของผู้ใช้ออกไปเอง v0.1 จึงต้องมี log ที่ไม่มีเนื้อหาอยู่บนเครื่องและสถานะ Machine ที่ Controller ใช้แสดงสุขภาพเครื่อง

## What Changes

- Runtime เขียน log แบบ JSON lines ที่ `<VEELOE_HOME>/runtime/logs/` หมุนรายวัน เก็บ 14 วัน; มีแค่รหัสเหตุการณ์, agent/task/turn id, tool name, duration, token และ error — ไม่มีข้อความแชต, ผล tool, ชื่อไฟล์ หรือความลับ
- เพิ่ม `veeloe logs [--follow]` สำหรับดู log บนเครื่อง
- Runtime ส่งสถานะ Machine ให้ Controller: version, features, last error, disk free และ Budget วันนี้
- Controller แสดงการ์ดสถานะในหน้า Machine; การขอ log จากแอปเป็น signed request และส่งกลับเป็น Attachment ในงานถัดไป

## Capabilities

### New Capabilities

- `runtime-logs`: log ที่ไม่มีเนื้อหา การหมุนไฟล์ และคำสั่งดู log
- `machine-status`: สถานะ Machine ที่ Controller แสดง

### Modified Capabilities

- `runtime-cli`: เพิ่ม `logs`
- `hub-relay`: ส่ง event สถานะ Machine

## Non-goals

- ส่ง log ทั้งไฟล์ผ่าน Hub ใน change นี้; จะทำพร้อม Attachment
- Crash reporting อัตโนมัติไปบริการภายนอก
- Log ที่มีเนื้อหาแม้ในระดับ debug

## Impact

- **Runtime:** `runtime-supervisor/src/logs.rs`, CLI, จุดเขียน log ที่สำคัญ, สถานะ Machine
- **Controller:** การ์ดสถานะ Machine, protocol `machine.status`
- **Hub:** ส่งต่อ event ตามปกติ; ไม่เก็บ log

## Acceptance anchor cases

- `veeloe logs` แสดง log ล่าสุด; `--follow` แสดงบรรทัดใหม่
- ไฟล์ log เก่ากว่า 14 วันถูกลบ
- log ไม่มีข้อความจาก Task, ผล tool หรือชื่อไฟล์
- Controller เห็น version/features/disk/budget/last error ของ Machine
