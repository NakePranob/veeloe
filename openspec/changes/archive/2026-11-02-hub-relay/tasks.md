## 1. กู้ของเดิม

- [x] 1.1 กู้ `hub/` จาก `33deb1a~1` และตรวจว่า `go build ./...`, `go vet ./...`, `go-scaffold check` และ `go test -race ./...` ผ่านโดยไม่แก้
- [x] 1.2 กู้ `hub-auth`, `hub-challenge` และ `hub-ready` พร้อม vector ของ handshake และ URL ของ Hub กลับเข้า `packages/protocol` และตรวจว่า test ของ fixtures ผ่าน
- [x] 1.3 เพิ่ม job ของ Hub ใน CI และ `check:hub` ใน `check` ที่ root พร้อม `@nakedev/go-scaffold` 0.14.0 และตรวจว่า `bun run check` รัน `go-scaffold check` ในเครื่องได้

## 2. Frame ของ Protocol

- [x] 2.1 เพิ่ม `member` ใน `hub.ready` และเพิ่ม `hub.error` ที่มี `code`, `params` และ `ref` ตรวจด้วย test และ vector ที่สร้างใหม่ รวมถึง `ready` ของ client ทั้งสองแบบ
- [x] 2.2 เพิ่มเส้นทางและ `recipients` ในหัวซองฝั่ง Go พร้อม helper ที่บอกว่าหัวซองใช้เส้นทางไหน และตรวจ `protocol_test.go` กับ schema และ vector ของซองทุกตัว

## 3. ตัวตนและการเชื่อมต่อ

- [x] 3.1 เพิ่ม module `controller`, migration และการค้นกุญแจ ตรวจด้วย test ของ repository ว่ากุญแจที่รู้จักคืน Member กับ Workspace และกุญแจที่ไม่รู้จักคืนไม่พบ
- [x] 3.2 เปลี่ยนการค้น Machine ของ relay เป็น port ค้นตัวตนผ่าน `internal/composition` ตรวจด้วย test ว่ากุญแจ Machine และ Controller ได้ `ready` ที่ถูกต้อง และกุญแจที่ไม่รู้จักถูกปิดด้วย 4401
- [x] 3.3 ปรับ presence ให้ใช้ตัวตน ตรวจด้วย test เรื่องการแทนที่ตามกุญแจ, Controller สองเครื่องของ Member เดียว และสายเก่าที่ปิดไม่ทำให้สายใหม่หลุด

## 4. การส่งต่อ

- [x] 4.1 เพิ่มคิวขาออกที่จำกัดขนาดและตัวเขียนของแต่ละสาย ตรวจด้วย test แบบ `-race` ว่าลำดับคงอยู่เมื่อส่งรัว และผู้รับที่ล้นถูกปิดขณะที่ผู้รับอื่นยังได้รับ
- [x] 4.2 ส่งต่อ `to` จาก Controller ถึง Machine ตรวจด้วย test แบบ socket ว่าส่งถึงด้วย byte เดิม, ได้ `hub.machine_offline` พร้อม `ref` เมื่อออฟไลน์ และตอบเหมือนกันสำหรับ Machine ที่ไม่รู้จักกับที่อยู่ Workspace อื่น
- [x] 4.3 ส่งต่อ `recipients` จาก Machine ถึง Controller ตรวจด้วย test แบบ socket เรื่อง Controller สองเครื่องของ Member เดียว, Member ที่ไม่ได้ต่ออยู่ไม่เกิด error และ Member ใน Workspace อื่นไม่ได้รับอะไร
- [x] 4.4 ปฏิเสธ `from` ที่ไม่ตรงและเส้นทางที่ client แบบนั้นใช้ไม่ได้ ตรวจด้วย test แบบ socket เรื่อง `hub.sender_mismatch` และ `hub.route_not_allowed` ทั้งสองทิศ
- [x] 4.5 ข้าม frame ที่ไม่ใช่ซองและซองที่มีทั้งสองเส้นทางหรือไม่มีเลย ตรวจด้วย test แบบ socket ว่าสายยังเปิดอยู่ และชนิดข้อความที่ไม่รู้จักยังถูกส่งต่อ

## 5. ปิดงาน

- [x] 5.1 ตรวจด้วย test ที่ส่งส่วนที่เซ็นซึ่งมีตัวทำเครื่องหมายผ่านทุกเส้นทาง ว่า log ของ Hub ไม่มีตัวทำเครื่องหมายนั้น และอ่านโค้ดยืนยันว่าไม่มีซองลง database
- [x] 5.2 เพิ่ม test ข้ามภาษาที่ Controller และ Machine ซึ่งเซ็นด้วย `packages/protocol` แลกซองผ่าน Hub binary ที่รันจริง และตรวจว่า `verify` ของผู้รับยอมรับ
- [x] 5.3 แก้ `AGENTS.md` เรื่อง Hub และการตรวจ และตรวจโดยอ่านเทียบกับ `package.json` ที่ root และ CI
- [x] 5.4 รัน `openspec validate hub-relay --strict`, `bun run check`, `bun run test` และ `go test -race ./...` ใน `hub` และตรวจว่าผ่านทั้งหมด
