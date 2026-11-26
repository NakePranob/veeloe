# Proposal: Stop และการปิด Turn ที่ค้างเมื่อเริ่มใหม่

## Why

วันนี้ Turn ของ Agent จบได้สามทางคือ LLM ตอบเสร็จ, Provider ล้มเหลว และชนเพดานรอบ ยังไม่มีทางที่ **คน** จะสั่งให้จบ เพราะแอปไม่มีปุ่ม Stop (ADR 0017 ตัดสินไว้แล้วแต่ยังไม่มีของ) ผลที่เห็นจริงตอนนี้คือคำสั่งที่วนไม่จบ (`sleep 1000`, build ที่ค้าง) ต้องรอจนครบ 120 วินาที หรือรอ Agent ทำงานไปเรื่อย ๆ และเมื่อ Approval ค้างอยู่ก็ไม่มีใครเบรกได้นอกจากปฏิเสธ

อีกด้านหนึ่ง worker พังหรือ Machine รีบูตได้ แต่ยังไม่มีใครปิด Turn ที่มี `turn.started` แล้วไม่มี `turn.ended` (ADR 0033) Turn นั้นจึงค้างอยู่ใน log ตลอดกาล แอปขึ้นว่า "กำลังทำงาน" ทั้งที่ไม่มีอะไรทำแล้ว และคนสั่งพิมพ์ต่อไม่ได้เพราะ Agent มองว่าตัวเองไม่ว่าง

## What Changes

- ซองใหม่ `task.stop` (Controller → Machine) ที่ Member ใช้หยุด Turn ที่กำลังทำของ Task หนึ่ง
- worker หยุด Turn ทันทีที่ได้ Stop: ยกเลิกคำขอ LLM ที่ค้างอยู่ หยุดคำสั่งที่รันอยู่ทั้ง process group ปิด Approval ที่รออยู่ทั้งหมดของ Turn นั้น แล้วเขียน event ว่า **ใคร** หยุด ตามด้วย `turn.ended` ที่มีเหตุผลว่า `stopped`
- ไฟล์ที่แก้ไปแล้วคงสภาพเดิม และ Task ยังคุยต่อได้ด้วย context เดิม (ADR 0017) — ไม่ย้อนอะไรกลับ
- ตอน worker เริ่มใหม่ (ทั้งเพราะพังแล้ว supervisor เปิดให้ และเพราะ Runtime เริ่มใหม่) worker ปิด Turn ที่ค้างทุกตัวของ Agent ตัวเองด้วย event `turn.interrupted` ตามด้วย `turn.ended` ที่มีเหตุผลว่า `interrupted` ไม่ทำต่อเอง (ADR 0033)
- Controller: ปุ่ม **หยุด** ในช่องพิมพ์เมื่อ Agent กำลังทำงานและยังไม่มีข้อความที่พิมพ์ค้าง (มีข้อความ = ปุ่มส่ง), ถามยืนยันก่อนหยุดพร้อมบอกว่าจะหยุดอะไร, แสดงบรรทัดว่าใครหยุด และการ์ด "Machine เริ่มใหม่กลาง Turn" พร้อมปุ่ม **ทำต่อ**
- สถานะใหม่ `interrupted` ("Turn ถูกขัดจังหวะ") ใน Inbox และหัว Task

ไม่แตะ: การอัปเดตตัวเองของ Runtime (ADR 0009), การปิด Turn ของ Task ย่อย (Delegation ยังไม่มีใน v0.1), และการย้อนไฟล์

## Capabilities

### New Capabilities

- `task-stop`: การสั่งหยุด Turn จาก Controller, สิ่งที่ worker ทำตอนหยุด, ใครหยุดได้, และการปิด Turn ที่ค้างเมื่อ worker เริ่มใหม่

### Modified Capabilities

- `task-log`: event kind ใหม่ `turn.stopped` กับ `turn.interrupted` และความหมายของ `turn.ended` ที่มีเหตุผล `stopped` / `interrupted`
- `controller-tasks`: ปุ่มหยุดและการยืนยัน, บรรทัดว่าใครหยุด, การ์ด Turn ถูกขัดจังหวะพร้อมปุ่มทำต่อ, สถานะ `interrupted`

## Impact

- `packages/protocol`: ซอง `task.stop`, ชนิด event ใหม่สองตัว และเหตุผลของ `turn.ended`
- `packages/runtime`: worker รับ Stop แล้วยกเลิกงานที่ค้าง (ต้องมี AbortSignal ผ่าน `Llm` และ `ToolRunner`), worker ปิด Turn ที่ค้างตอนเริ่ม, supervisor ส่งต่อ Stop ให้ worker
- `controller`: ปุ่มหยุดกับกล่องยืนยันในหน้า Task, การ์ด Turn ถูกขัดจังหวะ, สถานะและคำ TH/EN
- test: Stop ที่ตัดกลางคำขอ LLM และกลางคำสั่งจริง, การปิด Turn ที่ค้างตอนเริ่มใหม่, และ e2e ที่กด Stop จาก Controller แล้ว Turn จบจริงโดยคำสั่งที่รันค้างถูกฆ่า
