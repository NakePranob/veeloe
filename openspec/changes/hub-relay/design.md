## Context

เหตุผลดูที่ `proposal.md` ที่ `33deb1a~1` นั้น `hub/` เป็น modular monolith จาก go-scaffold 0.14.0 มี `relay` (surface `none`, presence ในหน่วยความจำ, WebSocket adapter ที่ `adapters/inbound/http/ws.go`) และ `machine` (ค้นกุญแจ) เคยผ่าน `go-scaffold check` และ `go test -race` และ ADR 0022 บันทึกข้อตกลงที่ทำให้ผ่านไว้

## Goals / Non-Goals

**Goals:**
- client สองตัวที่พิสูจน์ตัวตนแล้วแลกซองที่เซ็นผ่าน Hub จริงได้
- มี test ทุกเส้นทางที่ปฏิเสธการส่งต่อ

**Non-Goals:**
- การเขียนกุญแจของ Machine หรือ Controller, Workspace และรหัส Pairing: อยู่ใน `machine-pairing` ส่วน test ใส่ข้อมูลตั้งต้นเอง
- `to` ที่ชี้ Agent: อยู่ใน `agent-and-task` ซึ่งเพิ่มโปรไฟล์ของ Agent ให้ Hub (ADR 0006)
- push ถึง Member ที่ไม่ได้ต่ออยู่: อยู่ใน `push-notifications`
- frame `file.chunk` (ADR 0050): อยู่ใน `attachments`
- การถอนกุญแจ (ADR 0031): อยู่ใน `linking-and-revocation`
- การ deploy ได้แก่ VPS, Caddy, image บน GHCR และการสำรอง Postgres (ADR 0007)

## Decisions

**กู้ `hub/` แทนการ generate ใหม่** เพราะมีผลจาก scaffold พร้อม test ของ handshake, heartbeat และการแทนที่สายที่ใช้งานได้ แล้วจึงขยาย module `relay`

**กุญแจของ Controller มี module `controller` และตาราง `controller_svc` ของตัวเอง** (`public_key`, `member_id`, `workspace_id`) แบบเดียวกับ `machine` และ `relay` อ่านทั้งสองผ่าน `internal/composition` เพื่อให้ module ไม่ import กัน (ADR 0022)
- *ทางอื่น: ตาราง `identities` ตารางเดียว* แต่ Machine กับ Controller มี field และอายุต่างกัน และ `machine` มีอยู่แล้ว

**relay มี port ค้นตัวตนตัวเดียว ซึ่งคืน `{kind, id, workspace}`** presence เปลี่ยนเป็น registry ตามกุญแจสาธารณะ พร้อม index สองชุด คือ `(workspace, machine)` ไปยังหนึ่งสาย และ `(workspace, member)` ไปยังชุดของสาย และยังอยู่ในหน่วยความจำตราบที่ Hub เครื่องเดียวดูแล Workspace หนึ่ง (ADR 0007)

**แต่ละสายมีคิวขาออกที่จำกัดขนาดและ goroutine เขียนหนึ่งตัว** read loop ของผู้ส่งแค่ใส่คิว ลำดับต่อผู้ส่งจึงคงอยู่ และผู้รับที่ช้าไม่ถ่วงผู้ส่ง เพดานนับเป็น byte ค่าเริ่มต้น 4 MiB และตั้งค่าได้ เมื่อล้น สายจะถูกปิด แล้วผู้รับตามงานทันหลังต่อใหม่
- *ทางอื่น: เขียนตรงจาก read loop* ง่ายกว่า แต่ผู้รับที่ค้างตัวเดียวทำให้ผู้ส่งทุกคนที่ส่งหาค้างด้วย
- ถ้า `to` ทำให้คิวของ Machine ล้น ผู้ส่งจะได้ `hub.machine_offline` เพราะสายกำลังถูกปิด

**error ของ Hub เป็น frame ของตัวเองชื่อ `hub.error`** มี `code`, `params` ที่ไม่บังคับ และ `ref` ที่ไม่บังคับ (คือ `sig` ของซอง) frame นี้ไม่ได้เซ็น เพราะ Hub ไม่มีกุญแจเซ็น client จึงถือเป็นคำใบ้เรื่องการส่งเท่านั้น code ใช้รูปแบบตาม ADR 0065 และ `sig` ใช้อ้างอิงได้เพราะ Hub อ่านได้และผู้ส่งมีอยู่แล้ว

**Machine ที่ไม่รู้จักกับที่ออฟไลน์ตอบเหมือนกัน** เพื่อไม่ให้ Controller ไล่หารหัส Machine ของ Workspace อื่น

**แยกชนิด frame โดย decode เฉพาะ field ของหัวซอง** frame ที่มี `signed` และ `sig` คือซอง ใช้ struct แบบหลวมตัดสินเส้นทางแล้วส่ง byte เดิมต่อ read limit ยังเป็น 1 MiB ซึ่งพอสำหรับก้อน 256 KB แบบ base64 (ADR 0050)

**`hub.ready` ระบุ `machine` หรือ `member`** การเพิ่ม `member` เป็นแบบ additive (ADR 0023) และ vector ตรวจ field ที่ไม่บังคับเหล่านี้

**ฝั่ง Go อ่าน vector เฉพาะหัวซอง** กู้ `protocol_test.go` แล้วเพิ่มเส้นทางกับ `recipients` Hub ตรวจ Ed25519 เฉพาะตอน handshake (ADR 0012) vector ของ handshake จึงครอบส่วนนั้น Go stdlib กับ noble อาจเห็นต่างกันในลายเซ็นแปลกๆ แต่ client เซ็นด้วย RFC 8032 ของ noble ลายเซ็นปกติจึงตรวจผ่านทั้งคู่ และ vector ยืนยันเรื่องนี้

**test ในเครื่องใช้ socket จริงโดยไม่ต้องมี Postgres** `composition_test.go` ต่อ client เข้า relay จริงกับตัวค้นกุญแจปลอมเหมือนเดิม ส่วน test ของ repository ใช้วิธีเดิม

## Risks / Trade-offs

- [Hub ที่โดนเจาะหรือมี bug ส่งเนื้อหาผิด Controller ก่อนมี E2E] → ยอมรับได้ใน v0.1 และ v0.2 ที่มีผู้ใช้คนเดียว (ADR 0005, 0034) ผู้รับปฏิเสธซองที่ไม่ได้ส่งถึงตัวเอง ซึ่งจำกัดการเปลี่ยนทางได้ แต่ซ่อนเนื้อหาไม่ได้
- [Hub ที่โดนเจาะปลอม `hub.error`] → ทำได้แค่ให้ Controller ส่งใหม่หรือแสดงสถานะ ไม่สามารถอนุมัติหรือรันอะไรได้ Controller ต้องถือเป็นคำใบ้
- [ผู้รับที่คิวล้นเสีย frame] → ต่อใหม่แล้วขอ event ย้อนหลัง (ADR 0021) แต่คำสั่งที่ค้างในคิวของ Machine อาจหายโดยไม่มีการแจ้ง เพราะแจ้งออฟไลน์เฉพาะการส่งครั้งที่ทำให้ล้น Controller จึงต้องถือว่าคำสั่งถึงแล้วก็ต่อเมื่อเห็นผลลัพธ์ ซึ่ง `agent-and-task` ต้องทำตาม
- [dependency ที่กู้มาเก่า] → ตรวจ `go build` และ `go test -race` ตามที่กู้มาก่อน แล้วอัปเกรดแยกถ้ามีปัญหา
- [presence หายเมื่อ Hub เริ่มใหม่] → client ต่อใหม่เอง และระหว่างนั้นอีกฝั่งเห็นว่าออฟไลน์

## Migration Plan

ยังไม่มีอะไร deploy migration รันบน database ใหม่ และย้อนกลับได้ด้วยการเอา change ออก
