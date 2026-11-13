## Why

issue #44 (ชิ้นที่ 5 ของ #32): วันนี้คำขอไปโดเมนนอก Egress ถูกตัดเงียบ ๆ เจ้าของเครื่องไม่มีทางรู้และ Agent ไม่มีทางขอเพิ่มได้ ทั้งที่ #32 ออกแบบให้ขอ Approval และจำได้เมื่ออนุมัติถาวร

## What Changes

- proxy ต่อ Agent รู้ Turn ที่กำลังทำอยู่ (Agent, Member, Task) จาก event `turn.started`/`turn.ended`
- โดเมนนอก Egress → สร้าง `approval.requested` ของ Turn นั้น ส่งถึง Member ที่มี Approve ที่ Agent (ADR 0010) แล้วรอคำตอบ
- `approval.answer` เพิ่ม decision `always`; `always` เพิ่มโดเมนเข้า Egress ของ Agent ตัวนั้นด้วยคำสั่งที่ Owner เซ็น
- Controller แสดง approval ของโดเมนพร้อมปุ่ม อนุญาตครั้งนี้ / อนุญาตถาวร / ปฏิเสธ
- timeout หรือ Stop ของ Turn → ปฏิเสธและตัด connection

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: การขออนุญาตโดเมนนอก Egress
- `approvals`: approval ของโดเมนและ decision `always`

## Impact

- protocol: `approval.requested` body มี `kind`/`domain`, `approval.answer` decision เพิ่ม `always` (Rust + TS + vectors)
- runtime-supervisor: Turn context, proxy approval, routing `approval.answer`, Egress update
- controller: approval sheet + i18n
- test: อนุมัติครั้งเดียว/ถาวร/ปฏิเสธ/สิทธิ์ไม่พอ/ timeout, macOS + Linux
