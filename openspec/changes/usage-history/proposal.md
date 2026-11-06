# Proposal

## Why

`daily-budget` นับ token ที่ proxy และบังคับ Budget ได้แล้ว แต่ Machine เก็บยอดแค่ของวันนี้ใน `usage.json` แล้วเขียนทับเมื่อวันเปลี่ยน Owner จึงเห็นได้แค่ว่าวันนี้ใช้ไปเท่าไหร่ ไม่เห็นว่าใช้เพิ่มขึ้นหรือลดลง และไม่เห็นว่า token หมดไปกับงานไหน แม้ ADR 0043 จะกำหนดให้แอปแสดงยอดต่อวันต่อ Agent และยอดต่อ Member ต่อเดือนก็ตาม

## What Changes

- Machine เก็บประวัติการใช้ token **30 วัน** ใน SQLite ของ supervisor เป็นแถวต่อ (Agent, วันของ Budget, แหล่งที่มา, Task) โดยวันใช้เขตเดียวกับ Budget (เริ่ม 04:00 ตามเวลา Machine)
- ที่เก็บเดียวกับยอดที่ใช้บังคับ Budget: เลิกแยก `usage.json` แล้วนำเข้าครั้งเดียวเมื่อเปิดฐานข้อมูลครั้งแรก เพื่อไม่ให้มียอดสองที่ไม่ตรงกัน
- proxy ส่งรหัส Task มาพร้อมยอดของแต่ละคำตอบ และติดแหล่งที่มาเป็น `task` ใน v0.1 (Schedule, Idle Work, Watch และ Channel ยังไม่มี)
- Protocol: คำขอที่เซ็นแล้ว `usage.list` ที่ระบุจำนวนวันย้อนหลังและ Agent ที่ไม่บังคับ (Machine คำนวณช่วงจากวันของ Budget ของตัวเอง) และคำตอบ `usage.listed` ที่มีผลรวมรายวัน, Task ที่ใช้มากที่สุด และผลรวมตามแหล่งที่มา พร้อม `from`/`to` กับ `request` ที่สะท้อนกลับมา
- Controller แคชยอดรายวันไว้บนเครื่องเพื่อแสดงตอนออฟไลน์ และเพิ่มหน้า "การใช้ token" ที่เลือกช่วง **1 / 3 / 7 / 30 วัน** มีกราฟแท่งต่อวัน จัดกลุ่มตาม Machine และ Agent แสดงงานที่ใช้ token มากที่สุด และบอกเวลาที่ได้ข้อมูลล่าสุด
- หน้าเข้าจาก Workspace และแตะแถว Agent ไปหน้าของ Agent (การตั้ง Budget ยังอยู่ที่หน้าของ Agent ไม่ใช่หน้านี้)

## Capabilities

### New Capabilities

- `usage-history`: ประวัติการใช้ token บน Machine ทั้งที่เก็บ อายุการเก็บ ช่วงวันที่ที่ตอบได้ และการระบุแหล่งที่มากับ Task
- `controller-usage`: หน้ารวมการใช้ token ตามช่วงวันที่ กราฟและสรุป พร้อมข้อมูลแคชเมื่อออฟไลน์

### Modified Capabilities

ไม่มี — การนับ token ยังเป็นไปตาม `runtime-providers` และ `agent-settings` เดิม

## Impact

- **Runtime:** ที่เก็บใหม่ `packages/runtime/src/supervisor/usage/` (SQLite), `supervisor/budget/` อ่านยอดวันนี้จากที่เก็บเดียวกัน, `supervisor/proxy/proxy.ts` ส่ง Task กับยอด, `supervisor/usage` slice ใหม่ และ `supervisor/index.ts` ต่อทุกอย่างเข้าด้วยกัน
- **Protocol:** `packages/protocol/src/messages/usage.ts` ใหม่, ลงทะเบียนใน `messages/index.ts`, export จาก `index.ts`, เพิ่ม vector ใน `fixtures/build.ts`
- **Controller:** migration ตาราง `usage_day` กับคอลัมน์เวลาที่ดึงล่าสุด, `entities/agent` หรือ entity ใหม่สำหรับอ่านยอดรายวัน, `features/machine-link` ขอและรับ `usage.listed`, หน้าใหม่ `pages/usage`, ปุ่มใน `pages/workspace`, ไอคอน `usage` ใน `shared/ui/icon.tsx`, คำของ `usage.invalid_range` ใน `shared/i18n/errors`
- **ไม่แตะ:** Hub, worker, `ipc.ts`, adapter ของ LLM และกฎ dependency-cruiser
- **Dependency ใหม่:** ไม่มี — ใช้ `bun:sqlite` ตาม ADR 0014 และวาดกราฟด้วย View ของ React Native ไม่เพิ่มไลบรารีกราฟ
- **ADR:** `docs/adr/0066-usage-history-on-the-machine.md`

## Non-Goals

- ตัวเลขเงินหรือราคาโดยประมาณ (ADR 0043 ตัดสินให้นับ token)
- ยอดต่อ Member ต่อเดือน (ต้องรู้ Member เจ้าของ Turn ซึ่งยังไม่มี)
- กราฟแยกแหล่งที่มาที่มีความหมาย (v0.1 มีแค่ `task`; ที่เหลือมาเมื่อ Schedule, Idle Work, Watch และ Channel มีจริง)
- เพดาน Budget ระดับ Machine (ขัดกับกฎว่า Agent ตัวอื่นต้องไม่สะดุด)
- การตั้ง Budget จากหน้ารวม (ยังอยู่ที่หน้าของ Agent)
- เก็บประวัตินานกว่า 30 วัน หรือส่งออกเป็นไฟล์
- เนื้อหาแชตหรือชื่อไฟล์ในประวัติ — เก็บแต่จำนวน token กับรหัส Task
