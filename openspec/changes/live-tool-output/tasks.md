## 1. ADR และ Protocol

- [ ] 1.1 เขียน ADR ใหม่ใน `docs/adr/`:
  - ข้อความสดที่ไม่อยู่ใน Task log (`tool.output`)
  - เกณฑ์ Turn ค้างห้านาทีที่ supervisor
  - เหตุผลที่ไม่ให้ Controller ตัดสินเอง

  ตรวจว่าไม่ขัดกับ ADR 0018, 0023, 0034 และ 0060
- [ ] 1.2 เพิ่มข้อความ `tool.output` และ `TaskEventKind.TurnStalled` (`turn.stalled { since }`) ใน `packages/protocol-ts/src/messages/task.ts` และ `packages/protocol/src`; ตรวจด้วย `bun run check:protocol`
- [ ] 1.3 เพิ่ม vector ของทั้งสองข้อความใน `packages/protocol/vectors` ให้ Rust, TypeScript และสำเนาของ Hub อ่านตรงกัน และเพิ่ม test ว่า Controller ที่ไม่รู้จักข้ามได้; ตรวจด้วย `bun run check:protocol`

## 2. Runtime

- [ ] 2.1 ให้ `runtime-worker/src/tools/bash.rs` ส่ง chunk ของ output ผ่าน IPC ใหม่ใน `runtime-core/src/ipc.rs` ระหว่างที่คำสั่งรัน โดยไม่เปลี่ยนผลที่ LLM ได้; ตรวจด้วย `cargo test -p veeloe-runtime-worker` ว่าผลของ `bash` เหมือนเดิมทุก test เดิม
- [ ] 2.2 ให้ supervisor จำกัดอัตรา `tool.output` ไม่เกินหนึ่งครั้งต่อวินาทีต่อคำสั่ง ส่งเฉพาะท้ายไม่เกิน 2 KB และส่งเฉพาะ Controller ของ Member ที่เริ่ม Task; ตรวจด้วย test ใน `runtime-supervisor` ตาม scenario ของ `bash-tool` (build ที่พิมพ์ต่อเนื่อง, คำสั่งเงียบ, Member อื่น)
- [ ] 2.3 เพิ่มนาฬิกาค้างต่อ Turn ใน supervisor (เริ่มใหม่เมื่อมี event หรือ chunk, หยุดระหว่าง Approval รอ) และเขียน `turn.stalled` ครั้งเดียวต่อช่วงเงียบ โดยค่า `STALL_AFTER` ปรับได้ใน test; ตรวจด้วย `cargo test -p veeloe-runtime-supervisor -- --test-threads=1` ครบทุก scenario ของ requirement "Turn ที่เงียบเกินห้านาทีมี event turn.stalled"
- [ ] 2.4 ส่ง push หนึ่งครั้งต่อ `turn.stalled` ถึง Member ที่เริ่ม Turn ด้วยข้อความกลางๆ ผ่าน client ของ `push-notifications` (ต้อง archive `push-notifications` ก่อน); ตรวจด้วย test ของ push ใน `runtime-supervisor` ว่ามีหนึ่งครั้งต่อ event และไม่ถึง Member อื่น

## 3. Controller

- [ ] 3.1 รับ `tool.output` ใน `features/machine-link` และเก็บในหน่วยความจำตาม `tool_use_id` โดยลบเมื่อ `tool.result` มาถึง; ตรวจด้วย test ใน `links.test.ts`
- [ ] 3.2 แสดงเวลาที่รันไปและบรรทัดท้ายของ output ใน ToolGroup ของ `pages/task` ตามแบบ `Chat-Live` บน canvas (ต้องมี `task-thread-redesign` ก่อน); ตรวจด้วย `bun run test:e2e` ที่ใช้ Provider จำลองรันคำสั่งที่พิมพ์เป็นช่วงๆ และดูบน iOS Simulator
- [ ] 3.3 ให้ `moodOf()` คืน `stuck` เมื่อ event ล่าสุดที่รู้จักคือ `turn.stalled` และออฟไลน์ยังมาก่อน และเพิ่มคำ "Turn ค้าง" ในสถานะของ Inbox กับ header ทั้งสองภาษา; ตรวจด้วย test ของ `moodOf` ครบทุก scenario ของ requirement Mood ค้าง

## 4. ตรวจ

- [ ] 4.1 `bun run check`, `bun run test`, `bun run test:e2e` และ `go test -race ./...` ใน `hub/` ผ่าน
- [ ] 4.2 รันคำสั่งยาวจริงผ่าน `bun run dev` แล้วเห็น output สดบน iOS Simulator และจำลอง Provider ที่ไม่ตอบจนได้ Mood ค้างกับ push บนเครื่องจริง พร้อมภาพหน้าจอใน PR
