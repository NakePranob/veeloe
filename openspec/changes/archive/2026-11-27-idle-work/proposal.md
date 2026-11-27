## Why

Schedule ให้ Agent ทำงานตามเวลาได้แล้ว แต่ยังไม่มีทางให้ Agent ใช้เวลาว่างทำงานที่ค้างอยู่ เช่นเขียน test ที่ขาด หรืออัปเดต dependency ADR 0056 กำหนดให้เป็นลิสต์ที่ Member เซ็น Agent เสนอเรื่องเข้าลิสต์ได้ และตื่นมาทำเมื่อเงียบครบเวลา (issue #57)

## What Changes

- Trigger ชนิดใหม่ `idle` หนึ่งลิสต์ต่อ Agent: รายการงาน (ข้อความ และ `repeat` ถ้าให้วนกลับ), ลำดับ `ordered` หรือ `oldest-first`, เวลาเงียบก่อนตื่น (ค่าเริ่มต้น 15 นาที), เพดานเวลาต่อชิ้น (ค่าเริ่มต้น 15 นาที) และ scope ตาม ADR 0079
- supervisor ตื่นเมื่อ Agent ไม่มี Turn และไม่มี Turn จบภายในเวลาเงียบ แล้วเปิด Task ของงานชิ้นถัดไป ทำทีละชิ้น ไม่ชดเชยตอนเครื่องปิด
- รอบของ Idle Work เป็นรอบที่ไม่มีคนเฝ้า (ADR 0079): สิ่งนอก scope ถูกปฏิเสธทันที และงานชิ้นนั้นถูกทำเครื่องหมายว่าต้องการ Approval
- ข้อความที่เข้ามาระหว่างนั้นต่อคิวตามปกติ งานที่ถึงเพดานเวลาจบเหมือนโดน Stop และถูกทำเครื่องหมายว่าไม่เสร็จ
- สถานะต่อชิ้น (`pending`, `working`, `done`, `timedOut`, `needsApproval`) เก็บใน supervisor และส่งใน `trigger.listed`; ชิ้นที่เสร็จหายจากลิสต์ ส่วนชิ้น `repeat` กลับไปท้ายลิสต์
- tool `propose_idle_work` ให้ Agent เสนอเรื่องเข้าร่าง ร่างไม่มีผลจนกว่า Member จะเซ็นลิสต์ใหม่ทั้งลิสต์
- เพดาน token ร่วมของ Idle Work กับ Watch ต่อวัน ค่าเริ่มต้น 30% ของ Budget ตั้งได้ด้วย `agent.update` (`backgroundShare`); `usage` แยกที่มา `idle`
- Controller: หน้า Idle Work ใต้หน้า Agent (ลิสต์ สถานะต่อชิ้น กดไปที่ Task ร่างที่ Agent เสนอ แก้ใน sheet แล้วเซ็น)

## Capabilities

### New Capabilities

- `controller-idle-work`: หน้า Idle Work ของ Agent ใน Controller

### Modified Capabilities

- `triggers`: Trigger ชนิด `idle`, การตื่นเมื่อเงียบ, เพดานเวลา, สถานะต่อชิ้น, ร่างจาก Agent และเพดานงานพื้นหลัง
- `agent-settings`: `backgroundShare` ใน `agent.update`

## Impact

- **Protocol:** `trigger.ts`/`messages.rs` (`kind: "idle"`, `idle`, `draft` และสถานะใน `trigger.listed`), `agent.ts` (`backgroundShare`), vectors
- **Runtime:** core (`propose_idle_work`, เพดานเวลาของ Turn), supervisor (`triggers.rs`, `main.rs` tick, `usage.rs`, `agents.rs`)
- **Controller:** page slice ใหม่ `agent-idle-work`, แถวในหน้า Agent
- **Docs:** ไม่มี ADR ใหม่: ทำตาม ADR 0056, 0067 และ 0079 (ADR 0079 แทนข้อ "ตอบ Approval เองว่าข้าม" ด้วยกติกาเดียวกับ Schedule)
