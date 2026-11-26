## Context

- `controller/src/pages/devices/ui/DevicesPage.tsx` แสดง `device.name` จาก `entities/device`
- `controller/src/entities/device/model/devices.ts` เก็บ `device` table และ `name` มาจาก `device.link` certificate
- `controller/src/pages/link-device/model/link.ts` มี `nameProblem` ตรวจชื่อว่าง/ซ้ำตอน Link
- ADR 0013/0031 ให้ชื่อเครื่องเป็น metadata สำหรับหน้า My devices และการแจ้งตอน Link; Hub ไม่เก็บชื่อ Controller ในตาราง

## Terminology

- **Device name** คือชื่อที่แสดงในหน้า My devices ของ Controller เครื่องนั้น
- **Local rename** คือการแก้ `device.name` ในฐานข้อมูลของ Controller ที่ผู้ใช้กำลังถืออยู่
- **Linked name** คือชื่อที่มากับใบรับรอง `device.link` และ Controller เครื่องอื่นเห็น

## Decisions

### 1. Rename เป็น local-only ใน v0.1

**Decision:** เปลี่ยน `device` row ของ Controller เครื่องที่ทำการ rename เท่านั้น; ไม่ส่ง certificate และไม่แตะ Hub

**Why:** ชื่อเป็น metadata สำหรับหน้านี้ ไม่ได้ใช้ตัดสินสิทธิ์หรือความไว้ใจ; การซิงก์ข้ามเครื่องต้องมี schema/certificate และไม่จำเป็นต่อ v0.1

**Rejected:** `device.rename` certificate ผ่าน Hub — ต้องแก้ protocol, unique certificate key และทุกเครื่อง; เกินขอบเขต v0.1

**Rejected:** เก็บชื่อที่ Hub — Hub ไม่มีชื่อ Controller และไม่ควรเป็นแหล่งความจริงของ metadata นี้

### 2. ใช้ `nameProblem` เดิม

**Decision:** ใช้ `nameProblem(name, devices)` จาก link model เพื่อตรวจว่าง/ซ้ำกับ Controller ที่ยังใช้งาน

**Why:** กฎเดียวกับการตั้งชื่อตอน Link; ไม่สร้าง validator คู่ขนาน

### 3. เปลี่ยนชื่อได้เฉพาะ Controller ที่ยังใช้งาน

**Decision:** row ที่ `revoked_at !== null` ไม่มีปุ่ม rename; model ตรวจซ้ำอีกชั้น

**Why:** ชื่อของเครื่องที่ถูก revoke เป็นประวัติ; การแก้ทำให้สับสน

## Risks

- ชื่อบนเครื่องอื่นไม่เปลี่ยนตาม; ต้องบอกผู้ใช้ใน footer หรือข้อความใต้ช่อง
- ชื่อซ้ำกับ Controller ที่ถูก revoke ได้ เพราะ `nameProblem` เช็คเฉพาะที่ยังใช้งาน; ยอมรับได้

## Open decisions

- จะทำ `device-rename-sync` ด้วย certificate ในอนาคตหรือไม่
