## Why

Controller สร้าง Agent ได้แต่ลบไม่ได้ Agent ที่เลิกใช้จึงค้างในรายการและยังมี worker อยู่บน Machine กินทรัพยากรและเป็นพื้นที่ให้เข้าใจผิด v0.1 ต้องมีทางลบ Agent พร้อมยืนยัน และต้องตัดสินข้อมูลเดิมให้ชัด

## What Changes

- เพิ่มข้อความ `agent.delete` จาก Controller ถึง Machine พร้อม `id`
- Runtime ตรวจสิทธิ์ Manage/owner ก่อนลบ, หยุด worker ของ Agent, ลบ Agent ออกจาก `agents.json`, และลบ task-route ที่ผูกกับ Agent นั้น
- Workdir และ Task history ยังอยู่บนดิสก์; Agent ที่ลบแล้วไม่ปรากฏในรายการและไม่รับงานใหม่
- Controller มีปุ่มลบในหน้า Agent พร้อมกล่องยืนยันและยืนยันตัวใหม่
- Runtime ตอบ `agent.listed` หลังลบ เพื่อให้ Controller ลบแถว local ตามข้อมูลจริง

## Capabilities

### New Capabilities

- `agent-deletion`: การลบ Agent จาก Controller และ Runtime

### Modified Capabilities

- `runtime-agents`: การลบ Agent และการหยุด worker
- `controller-tasks`: การลบ Agent ออกจากรายการ local

## Non-goals

- ลบ Workdir หรือไฟล์ของผู้ใช้
- ลบ Task history หรือ event log
- ย้าย Agent ไป Machine/Workspace อื่น
- ลบ Provider ที่ Agent เคยใช้

## Impact

- **Protocol:** `agent.delete` body `{ id }` ใน TypeScript และ Rust
- **Runtime:** dispatch, `AgentRegistry::remove`, `Workers::stop`, `TaskRoutes::forget`
- **Controller:** `links.deleteAgent`, หน้า Agent, `saveAgents` ลบแถวที่ Machine ไม่ส่งมา, i18n, test
- **Hub:** ไม่เปลี่ยน; ส่งต่อ envelope ตามปกติ

## Acceptance anchor cases

- Owner ลบ Agent ที่ไม่มีงานกำลังทำ; Agent หายจากรายการและสร้างใหม่ด้วย id เดิมได้
- Owner ลบ Agent ที่มี Task history; Task เดิมยังเปิดอ่านได้ แต่ Agent หายจากรายการ
- Member ที่ไม่มี Manage ลบ Agent ไม่ได้
- ปิด/เปิดแอปหลังลบ; Agent ไม่กลับมา
- Workdir ของ Agent ยังอยู่บนดิสก์
