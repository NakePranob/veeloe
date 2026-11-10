## Context

- Runtime ใช้ `println!` กระจัดกระจาย; ยังไม่มีไฟล์ log
- `runtime-supervisor/src/status.rs` มีคำสั่ง `veeloe status`
- Controller มี `MachineStatus` ใน `features/machine-link` แต่เป็นสถานะ connection/providers เท่านั้น
- ADR 0052 กำหนด log ที่ไม่มีเนื้อหา, หมุนรายวัน 14 วัน, `veeloe logs`, สถานะ Machine และการขอ log ผ่าน signed request/Attachment

## Decisions

### 1. Log เป็น JSON lines แยกไฟล์รายวัน

**Decision:** เขียน `<home>/runtime/logs/<day>.log` เป็น JSON lines; day = จำนวนวันตั้งแต่ Unix epoch; เก็บ 14 ไฟล์; ลบไฟล์เก่ากว่า

**Why:** ง่ายต่อการ tail/parse และไม่ต้องเพิ่ม dependency วันที่

### 2. Caller ส่งเฉพาะรหัส ไม่ส่งข้อความ

**Decision:** `record(home, level, event, fields)` รับเฉพาะ field ที่เป็น id/ตัวเลข/รหัส; ห้าม caller ส่ง text/content

**Why:** ADR 0052; ป้องกันเนื้อหาหลุดโดยไม่ต้องกรองที่ logger

### 3. `veeloe logs` อ่านไฟล์; `--follow` tail

**Decision:** CLI รวมไฟล์ตามวันและพิมพ์; `--follow` วนอ่านบรรทัดใหม่จน Ctrl-C

**Why:** ใช้งานบนเครื่องได้โดยไม่ต้องมีแอป

### 4. สถานะ Machine เป็น event ที่ Runtime ส่ง

**Decision:** Runtime ส่ง `machine.status` ให้ Owner เมื่อต่อ Hub และเมื่อค่าเปลี่ยน; Controller เก็บใน memory/DB และแสดงการ์ด

**Why:** Controller ต้องรู้ version/features/disk/budget โดยไม่ต้องถามทุกครั้ง

**Open:** จะส่ง log ทั้งไฟล์ผ่าน Hub ใน change นี้หรือทำพร้อม Attachment ใน change ถัดไป

## Risks

- Log อาจมี path/ชื่อไฟล์หลุดถ้า caller ไม่ระวัง; ต้องมี test
- Rotation ด้วย day ตั้งแต่ epoch ไม่ตรง timezone; ยอมรับได้สำหรับ v0.1
- `--follow` ต้องหยุดด้วย Ctrl-C; ไม่มี watcher
