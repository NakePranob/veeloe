## Why

Runtime ทำทีละ Turn ต่อ Agent อยู่แล้ว แต่ Controller ยังปิดช่องส่งข้อความขณะ Agent ไม่ว่าง ผู้ใช้จึงต้องรอTurn จบก่อน ทั้งที่ Runtime มีคิวอยู่แล้ว v0.1 ต้องให้ผู้ใช้ส่งงานล่วงหน้าได้และเห็นว่าข้อความรออยู่

## What Changes

- Controller ยอมให้พิมพ์และส่งข้อความขณะ Turn กำลังทำงาน
- ข้อความที่ส่งระหว่าง Turn ทำงานจะถูกใส่คิวใน Runtime ตามลำดับ
- ช่องข้อความบอกว่าข้อความจะรอ Turn ปัจจุบันจบ
- Queue position และ event `task.queued` เป็นงานถัดไป (ยังไม่ทำในรอบนี้)

## Capabilities

### New Capabilities

- `task-queue`: การส่งข้อความเข้าคิวขณะ Agent ไม่ว่าง

### Modified Capabilities

- `controller-tasks`: Composer ไม่ปิดการส่งเมื่อ Agent ไม่ว่าง

## Non-goals

- แสดงเลขลำดับคิวแบบเรียลไทม์
- ยกเลิกข้อความที่อยู่ในคิว
- คิวที่อยู่รอดหลัง Runtime restart (ADR 0011 ยังไม่กำหนด persistence)

## Impact

- **Controller:** `pages/task` เปลี่ยนเงื่อนไข busy และ placeholder, i18n th/en
- **Runtime:** ไม่เปลี่ยน; ใช้คิว `Workers` เดิม
- **Protocol:** ไม่เปลี่ยน

## Acceptance anchor cases

- Agent กำลังทำงาน; ผู้ใช้พิมพ์ข้อความใหม่แล้วกด Send ได้
- ข้อความใหม่ไม่ถูกทิ้งและถูกประมวลผลหลัง Turn ปัจจุบันจบ
- ปุ่ม Stop ยังแสดงเมื่อ Agent ไม่ว่างและยังไม่ได้พิมพ์อะไร
