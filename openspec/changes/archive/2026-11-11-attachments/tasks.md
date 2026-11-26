## 1. Protocol

- [x] 1.1 `file.chunk` schema และ Rust validation
- [x] 1.2 `attachments` ใน `task.message`

## 2. Runtime

- [x] 2.1 `Uploads`: รับ chunk, ตรวจ total/index, cap 20 MB, hash SHA-256
- [x] 2.2 `file.chunk` dispatch
- [x] 2.3 `task.message`: take ไฟล์, ตรวจ size, เขียน Workdir, เติม path
- [x] 2.4 test reassembly และ hash ผิด

## 3. Controller

- [x] 3.1 `expo-document-picker` + paperclip
- [x] 3.2 chip ไฟล์แนบ, ลบก่อนส่ง
- [x] 3.3 `sendAttachment` ส่ง 256 KiB chunks ก่อน message
- [x] 3.4 i18n th/en

## 4. ตรวจ

- [x] 4.1 `cargo test -p veeloe-runtime-supervisor --lib uploads`
- [x] 4.2 `cargo test -p veeloe-runtime-supervisor --no-run`
- [x] 4.3 `bun run typecheck`, `check:controller`, `check:protocol`
- [x] 4.4 QA Android: เลือก `window.xml`, ส่ง, Agent ตอบ และไฟล์อยู่ที่ `workdir/attachments/<task>/`
- [x] 4.5 QA ไฟล์ >20 MB ผ่าน UI: Android emulator เลือก `big.bin` 22 MB แล้วขึ้น "ไฟล์ใหญ่เกิน 20 MB ส่งผ่านแอปไม่ได้ ให้ใช้ git หรือ Connector แทน"
- [x] 4.6 `send_file` tool, `file.offered` card, `file.get` และ chunk กลับ Controller (QA ด้วย `opencode-go`/`deepseek-v4.1-flash` แล้ว)
- [x] 4.7 hash mismatch: Controller คำนวณ hash เอง จึงไม่เกิดผ่าน UI; ครอบด้วย `links.test` ว่าไบต์ไม่ตรง hash แล้วไม่เขียนและไม่เปิด
