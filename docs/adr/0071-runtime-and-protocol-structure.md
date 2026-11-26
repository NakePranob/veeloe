# โครงสร้าง Runtime, protocol และ rustfmt

Status: accepted
Tools: rustfmt 1.10.0, checked 2026-11-16 from `rustfmt --version`

แก้ ADR 0070 (supervisor ที่เป็น module แบน และขอบเขตของ `packages/.conventions/`)

รอบ ADR 0070 บันทึกโครงของ Runtime ตามโค้ดโดยไม่ได้ถามเจ้าของ ส่วน `packages/protocol` กับ `packages/protocol-ts` ไม่มีกฎเลย และ Rust ไม่มีใครตกลงเรื่อง format ไฟล์ 40 ไฟล์จึงไม่ตรงกับ rustfmt พอใครรัน `cargo fmt` ไฟล์ที่ไม่เกี่ยวก็ติดไปใน diff

**การตัดสินใจ:**

- **crate ของ Runtime** คงทิศเดิม `plugin-api` ← `runtime-core` ← `runtime-worker` ← `runtime-supervisor` และ supervisor ใช้ worker ผ่าน `entry` อย่างเดียว เพิ่มกฎว่า `plugin-api` ไม่เอ่ยชื่อ crate veeloe ตัวอื่น เพราะ plugin build กับมันตัวเดียว
- **supervisor ไม่แบนอีกต่อไป** handler ของข้อความ Hub อยู่ใน `src/messages/` ไฟล์ละข้อความ และ `tasks::dispatch` ส่งงานเข้าไป คำสั่ง CLI อยู่ใน `src/cli/` และ service (egress, proxy, approval, git broker และตัวอื่น) อยู่ที่ `src/` เหมือนเดิม handler ไม่ใช้ handler ตัวอื่นและไม่ใช้ `super::` ของที่ใช้ร่วมกันอยู่ใน `messages/shared.rs` หรือเป็น service ที่ `src/` ใน `messages/` กับ `cli/` ไม่มีโฟลเดอร์ย่อย
- **protocol เป็นปลายทางของการพึ่งพา** `packages/protocol` ไม่เอ่ยชื่อ crate veeloe ตัวอื่น ส่วน `packages/protocol-ts` import ได้แค่ไฟล์ของตัวเอง, dependency ที่ประกาศใน `package.json`, `bun:` และ `node:` ทั้งสามฝั่ง (Rust, TS และสำเนาใน Hub) ยังตรวจว่าตรงกันด้วย `vectors/` ผ่าน `check:protocol`
- **rustfmt** ใช้ค่าเริ่มต้น ไม่มี `rustfmt.toml` format ทั้งหมดครั้งเดียวใน commit ของมันเอง ซึ่งอยู่ใน `.git-blame-ignore-revs` แล้ว `cargo fmt --check` ของ Runtime และ protocol รันใน `bun run check:structure` ซึ่ง `bun run check` และ CI รันอยู่แล้ว

ทุกข้ออยู่ใน `packages/.conventions/rules.json` พร้อมไฟล์ที่ต้องถูกปฏิเสธและไฟล์ที่ต้องผ่าน ตัวตรวจคือ test `structure` ของ `runtime-core` ซึ่งตอนนี้อ่าน `../protocol` และ `../protocol-ts` ด้วย

## Considered Options

- **คง supervisor แบน:** ไม่ต้องย้ายไฟล์ แต่ handler ตัวที่สิบไม่รู้ว่าควรอยู่ตรงไหน และเคยมี handler ที่ใช้ของ handler อื่น (`egress_set` ใช้ `agent_config::listed`)
- **ไม่ตั้งกฎให้ protocol:** `check:protocol` จับได้แค่ว่าสามฝั่งตรงกัน ไม่จับว่า protocol เริ่มพึ่ง Runtime หรือ protocol-ts พึ่ง Controller
- **ห้ามรัน `cargo fmt`:** ไม่ต้องแก้ไฟล์เดิม แต่ตรวจไม่ได้ และ IDE กับ agent ก็เผลอรันอยู่ดี

## Consequences

- handler ใหม่เป็นไฟล์ใหม่ใน `messages/` บวกหนึ่งบรรทัดใน `messages/mod.rs` และหนึ่ง arm ใน `tasks::dispatch`
- `git blame` ข้าม commit ที่ format เมื่อตั้ง `git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub อ่านไฟล์นี้เอง)
- ก่อน commit โค้ด Rust ให้รัน `cargo fmt` ใน workspace ที่แก้
