## 1. Protocol: กุญแจและซอง

- [x] 1.1 เพิ่ม `zod` (v4) กับ `@noble/curves` แบบ pin เวอร์ชันใน `packages/protocol` พร้อมตัวช่วย base64url กับ Ed25519 (สร้างคู่กุญแจจาก seed, sign และ verify) ตรวจด้วย Protocol test ที่เทียบกับ vector ของ RFC 8032
- [x] 1.2 เขียน schema ของหัวซองกับส่วนที่เซ็นด้วย Zod แบบ loose และเขียน `createSigner(privateKey, nextSeq)` ตามข้อ 1 ใน design ตรวจด้วย Protocol test ว่า `signed` เป็น JSON string ที่มีสำเนาของ `type`, `to`, `task` และ `member` กับ `seq` จาก `nextSeq`
- [x] 1.3 เขียน `verify(envelope, trustedKeys, seen)` ตามลำดับในข้อ 2 ของ design พร้อมตัวเก็บ seq ในหน่วยความจำ ตรวจด้วย Protocol test ที่ครอบทุก scenario ใน `specs/protocol-envelope` (กุญแจที่ไม่ไว้ใจ, ลายเซ็นผิด, byte ที่ถูกแก้, เปลี่ยนปลายทาง, เปลี่ยน Member, เลขซ้ำ, เลขต่ำกว่า, เลขข้าม และ field ที่ไม่รู้จัก)
- [x] 1.4 เพิ่มข้อความ `hub.challenge`, `hub.auth` และ `hub.ready` กับฟังก์ชันที่สร้าง byte ที่เซ็นตอนจับมือจาก URL ที่ normalize แล้วกับ nonce ตรวจด้วย Protocol test ว่า URL ที่ต่างกันแค่ตัวพิมพ์ใหญ่หรือ `/` ท้ายได้ byte ชุดเดียวกัน
- [x] 1.5 เพิ่มตัวแยก frame ที่บอกได้ว่าเป็นชนิดที่ไม่รู้จัก ตรวจด้วย Protocol test ว่า frame ชนิดที่ไม่รู้จักถูกข้าม และ frame ที่ตามมายังถูกจัดการ

## 2. Protocol: JSON Schema และ test vector

- [x] 2.1 เพิ่มสคริปต์สร้าง JSON Schema ของหัวซองลงไฟล์ที่ commit ไว้ ตรวจด้วย Protocol test ที่ล้มเมื่อไฟล์ไม่ตรงกับ schema ปัจจุบัน
- [x] 2.2 เพิ่มสคริปต์สร้าง test vector จาก seed ของ test ให้ครอบตามรายการในข้อ 5 ของ design (รวมข้อความภาษาไทย อักขระควบคุม และ `\u`) ทุกกุญแจเขียนกำกับว่าเป็นของ test ตรวจด้วย Protocol test ที่อ่าน vector ทุกตัวแล้วได้ผลตามที่คาด

## 3. Hub: module `machine`

- [x] 3.1 รัน `go-scaffold generate module machine --profile lean` เพิ่ม migration ของตาราง `machines` ตามข้อ 4 ของ design และลบ route ที่ scaffold สร้างแต่ยังไม่ใช้ ตรวจด้วย `go-scaffold check` ที่ผ่าน และ `make migrate-up` กับ `make migrate-down` ที่ผ่านบน Postgres ของ dev
- [x] 3.2 เพิ่มความสามารถหา Machine จากกุญแจสาธารณะ ตรวจด้วย unit test ของ application ว่าได้ Machine ที่ถูกตัว และได้ "ไม่พบ" เมื่อกุญแจไม่รู้จัก

## 4. Hub: การจับมือและ presence

- [x] 4.1 เพิ่ม struct ของหัวซองใน `internal/shared/protocol` พร้อม Go test ที่เทียบชื่อ field กับชนิดใน json tag กับ JSON Schema และตรวจลายเซ็นของ vector ทุกตัวด้วย `crypto/ed25519` ตรวจด้วย `go test ./internal/shared/protocol` ที่ผ่าน และล้มเมื่อลองเปลี่ยนชื่อ field
- [x] 4.2 เพิ่ม keyauth ใน `internal/shared/middleware`: ส่ง challenge, รับคำตอบ, ตรวจกุญแจ ลายเซ็น และ URL, timeout, read limit ก่อนจับมือ และ close code ตามข้อ 3 ของ design ตรวจด้วย unit test ที่ใช้ vector ของคำตอบ challenge ครอบทุก scenario ใน requirement "Only a known key with a valid signature gets in" และ "The handshake has a deadline"
- [x] 4.3 เพิ่ม `adapters/inbound/http/ws.go` ของ relay ที่รับ `/connect`:
  - port `MachineKeys` กับ `PresenceRegistry` ในหน่วยความจำ
  - กฎที่ให้สายใหม่แทนสายเก่า, heartbeat และการข้าม frame ที่ไม่รู้จัก
  - adapter ใน `internal/composition` ที่ต่อ `MachineKeys` กับ module `machine`
  - config `HUB_PUBLIC_URL`, `HUB_HANDSHAKE_TIMEOUT` และ `HUB_HEARTBEAT_INTERVAL`

  ตรวจด้วย `composition_test.go` ที่ต่อ client สองตัว:
  - ครอบทุก scenario ของ requirement "The Hub knows which Machines are online" กับ "Unknown frames after authentication are skipped"
  - สายที่ค้างนานกว่า timeout ของ server ต้องไม่โดนตัด
  - `go test -race ./...` ผ่าน
- [x] 4.4 ต่อ relay กับ adapter ใน `cmd/api/wiring.go` และเพิ่ม config ใหม่ใน `.env.example` ตรวจด้วย `go build ./...` กับ `go-scaffold check` ที่ผ่าน

## 5. Runtime: config, trust และ hub-link

- [x] 5.1 เพิ่ม config ของ supervisor: `VEELOE_HOME` (สร้างด้วยสิทธิ์ 0700), `hubUrl` ใน `config.json` และ `VEELOE_HUB_URL` ที่ทับค่าได้ พร้อม error เมื่อไม่ได้ตั้ง ตรวจด้วย unit test ที่ครอบทุก scenario ของ requirement "The Hub URL is configurable"
- [x] 5.2 เพิ่ม trust: สร้างหรือโหลด `machine.key` สิทธิ์ 0600 และปฏิเสธเมื่อสิทธิ์กว้างเกินไป ตรวจด้วย unit test ในโฟลเดอร์ชั่วคราวที่ครอบทั้งสาม scenario ของ requirement "The Machine key is created once and kept private"
- [x] 5.3 เพิ่ม hub-link: ต่อ `<hubUrl>/connect` จับมือด้วยฟังก์ชันของ Protocol รายงานว่าต่อได้หรือถูกปฏิเสธ และ backoff (1 วินาที คูณสองจนถึง 30 วินาที, full jitter, เริ่มใหม่หลังต่อสำเร็จ) ตรวจด้วย unit test ของ backoff ที่ใช้ Clock กับตัวสุ่มปลอม และ test ของ hub-link กับ WebSocket server ปลอมใน test ที่ครอบการจับมือ การถูกปฏิเสธ และการต่อใหม่
- [x] 5.4 ให้ `runSupervisor` เรียก config, trust และ hub-link ตามลำดับ ตรวจด้วย dependency-cruiser ที่ผ่าน และ binary ที่ build แล้วต่อ server ปลอมของข้อ 5.3 ได้

## 6. e2e

- [x] 6.1 ให้ preload ของ e2e รัน `make migrate-up` ก่อนเปิด Hub ตั้ง `HUB_PUBLIC_URL` เปิดทาง restart Hub ให้ test เรียก และ build binary ของ Runtime ตรวจด้วย test `/readyz` เดิมที่ยังผ่าน
- [x] 6.2 เพิ่ม e2e ที่ Runtime ตัวจริงกับกุญแจที่ seed ไว้ต่อได้และรายงานว่าต่อแล้ว และเมื่อ Hub restart แล้ว Runtime ต่อกลับเอง ตรวจด้วย `bun run --cwd e2e test` ที่ผ่าน
- [x] 6.3 เพิ่ม e2e ที่ client ใน test ถูกปฏิเสธด้วย close code ที่ถูกต้องในทุกกรณีของข้อ 7 ของ design ตรวจด้วย `bun run --cwd e2e test` ที่ผ่าน

## 7. ปิดงาน

- [x] 7.1 รันทุก check บนเครื่องให้ผ่าน:
  - `bun run check`
  - ขั้นของ Hub ตาม `ci.yml` (build, vet, gofmt, golangci-lint และ `go test -race`)
  - `bun run --cwd e2e test`

  ถ้าคำสั่งเปลี่ยน ให้อัปเดตหัวข้อ Checks ใน AGENTS.md
