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
- [ ] 4.5 QA ไฟล์ >20 MB และ hash mismatch ผ่าน UI
- [x] 4.6 `send_file` tool, `file.offered` card, `file.get` และ chunk กลับ Controller (ยังไม่ QA ด้วย model จริง)
