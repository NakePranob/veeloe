## 1. Crypto

- [x] 1.1 เพิ่ม `sealed.rs` ฝั่ง Rust (X25519 + HKDF-SHA256 + AES-256-GCM) และ `sealed.ts` ฝั่ง Controller (`@noble/curves` + `@noble/ciphers`)
- [x] 1.2 เพิ่ม test vector ที่ Controller seal แล้ว Rust เปิดได้, เครื่องอื่นเปิดไม่ได้
- [x] 1.3 เพิ่ม dependency `@noble/ciphers` และ Rust `x25519-dalek`/`hkdf`/`aes-gcm`

## 2. Protocol/Runtime

- [x] 2.1 เพิ่ม `provider.add` schema/validation ทั้ง TypeScript และ Rust
- [x] 2.2 เพิ่ม `Machine.secret_key` และ dispatch `provider.add`: open sealed key, detect auth, save providers, ตอบ `agent.listed`
- [x] 2.3 เพิ่ม error `provider.exists`/`provider.invalid`/`provider.unavailable` ในเส้นทางที่เกี่ยวข้อง

## 3. Controller

- [x] 3.1 เพิ่ม `links.addProvider` ที่ seal key ด้วย `machine.public_key`
- [x] 3.2 เพิ่มฟอร์ม Add Provider ใน MachinePage (name/url/key), fresh authentication, clear key หลังส่ง
- [x] 3.3 เพิ่ม i18n th/en และแสดง error
- [ ] 3.4 เพิ่ม preset picker (งานถัดไป)

## 4. ตรวจ

- [x] 4.1 `cargo test -p veeloe-protocol --lib sealed`
- [x] 4.2 `cargo test -p veeloe-runtime-supervisor --no-run`
- [x] 4.3 `bun run typecheck`
- [x] 4.4 `bun run check:controller`
- [x] 4.5 QA Android: เพิ่ม mock Provider ผ่านฟอร์มแล้ว Machine แสดง `mock2` + 1 model
