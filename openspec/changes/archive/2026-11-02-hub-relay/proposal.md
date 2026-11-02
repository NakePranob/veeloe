## Why

`packages/protocol` เซ็นและตรวจซองได้แล้ว แต่ยังไม่มีอะไรส่งซองระหว่าง Controller กับ Runtime Hub จึงเป็นงานถัดไปใน `docs/roadmap.md` และ `machine-pairing` กับทุก change ถัดไปในเส้นทางแรกต้องพึ่งมัน

Hub ที่ถูกลบใน `33deb1a` พิสูจน์กุญแจของ Machine และรู้ว่าใครออนไลน์ แต่ไม่รู้จัก Controller และไม่ส่งต่ออะไรเลย ทุก frame หลัง handshake ถูกข้าม

## What Changes

- กู้ `hub/` จาก `33deb1a~1` ได้แก่โปรเจกต์ go-scaffold, module `machine` กับ `relay`, handshake และ heartbeat
- กู้ข้อความ handshake กลับเข้า `packages/protocol` พร้อม vector
- ให้ Controller พิสูจน์ตัวตนได้เหมือน Machine ผ่านตารางกุญแจของ Controller ส่วนการเขียนลงตารางมาพร้อม `machine-pairing`
- ส่งต่อซอง: `to` ไปถึงสายของ Machine และ `recipients` ไปถึง Controller ที่ต่ออยู่ทุกเครื่องของ Member เหล่านั้น เฉพาะใน Workspace ของผู้ส่ง
- ตอบผู้ส่งทันทีเมื่อ Machine ออฟไลน์ ด้วย code ที่ Controller แปลได้ (ADR 0005, 0065)
- ตรวจหัวซองฝั่ง Go กับ schema และ vector ที่เผยแพร่ใน CI

## Capabilities

### New Capabilities
- `hub-connection`: Machine หรือ Controller ต่อเข้า Hub พิสูจน์กุญแจ คงการเชื่อมต่อ และถูกแทนที่อย่างไร
- `hub-relay`: Hub ส่งต่อซองที่ตัวเองไม่ต้องเชื่อเนื้อในอย่างไร โดยไม่เก็บไว้

### Modified Capabilities

ไม่มี `protocol-envelope` กำหนดอยู่แล้วว่า implementation ทุกตัวต้องตรวจกับไฟล์ที่เผยแพร่ และ Hub จะเป็นหนึ่งในนั้น

## Impact

- **โค้ดใหม่:** `hub/` (Go, Gin, GORM, Postgres, `coder/websocket`) และ `packages/protocol/src/messages/hub-*.ts`
- **Database:** กู้ schema `machine_svc` และเพิ่ม `controller_svc`
- **เครื่องมือ:** `check` ที่ root เพิ่ม `go-scaffold check` โดยมี `@nakedev/go-scaffold` 0.14.0 เป็น dev dependency, CI เพิ่ม job ของ Hub และ `AGENTS.md` แก้ส่วนที่พูดถึง Hub กับการตรวจ
- **change ถัดไป:** `machine-pairing` เขียนกุญแจของ Machine และ Controller, `agent-and-task` ทำให้ `to` ชี้ Agent ได้ และ `push-notifications` ดูแล Member ที่ไม่ได้ต่ออยู่
