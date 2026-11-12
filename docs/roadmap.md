# Roadmap

ไฟล์นี้บอกว่าแต่ละเวอร์ชันต้องทำ change อะไรบ้าง และทำถึงไหนแล้ว เราดูแลเอง ไม่ได้เป็นส่วนหนึ่งของ OpenSpec เฟสและขอบเขตมาจาก ADR 0048 ถ้าขัดกัน ให้เชื่อ ADR

## วิธีใช้

- เปิด change ใน `openspec/changes/` เมื่อถึงคิวเท่านั้น ไม่ร่างล่วงหน้า เพราะ change หลังๆ จะล้าสมัยก่อนได้ทำ
- change หนึ่งต้องจบแล้วลองใช้หรือทดสอบได้จริง ถ้า `tasks.md` เกินราว 15 ข้อให้แยก
- archive แล้วติ๊กที่นี่ใน commit เดียวกัน ถ้าทำงานแล้วเจอของใหม่ เพิ่มบรรทัดได้เลย
- ชื่อ change และลำดับด้านล่างเป็นแผนตั้งต้น ปรับได้เมื่อรู้มากขึ้น แต่ขอบเขตของเวอร์ชันเปลี่ยนต้องแก้ ADR 0048

## v0.1: Owner คนเดียวสั่ง Agent บนเครื่องตัวเองจากมือถือ

### เส้นทางแรก

พิสูจน์ความเสี่ยงหลักก่อน คือการเซ็นคำสั่ง sandbox และ Approval เมื่อจบชุดนี้ ต้องสั่งงานจากมือถือ และอนุมัติคำสั่งที่รันใน sandbox บนเครื่องจริงได้

- [x] `protocol-envelope`: หัวซอง รายชื่อผู้รับ การเซ็น และรูปแบบ error code (ADR 0006, 0012, 0019, 0023, 0034, 0065)
- [x] `hub-relay`: Hub ส่งต่อซองโดยไม่เก็บเนื้อหา รอ `protocol-envelope` (ADR 0005, 0007, 0014)
- [x] `controller-foundation`: แอป local-first และระบบข้อความ TH กับ EN พร้อมตรวจ key ใน CI (ADR 0021, 0022, 0065)
- [x] `controller-device-key`: กุญแจบนเครื่องที่เปิดใช้ได้หลังยืนยันตัว รอ `protocol-envelope`, `controller-foundation` (ADR 0012)
- [x] `machine-pairing`: ผูก Machine กับ Controller ด้วย QR รอ `hub-relay`, `controller-device-key` (ADR 0013)
- [x] `agent-and-task`: สร้าง Agent, supervisor กับ worker, Task แบบ event log และคุยกับ Provider ผ่าน proxy รอ `machine-pairing` (ADR 0004, 0018, 0020, 0032, 0042)
- [x] `sandboxed-commands`: คำสั่งรันใน sandbox บน macOS และ Linux พร้อม Egress รายชื่อเดียวทั้ง Machine รอ `agent-and-task` (ADR 0008)
- [x] `workdir-file-tools`: tool อ่านและเขียนไฟล์ใน Workdir (read, write, edit, glob, grep) (ADR 0008, 0011, 0032)
- [x] `approval-and-allowlist`: ขอและตอบ Approval พร้อม Allowlist รอ `sandboxed-commands` (ADR 0030)

### ส่วนที่เหลือของ v0.1

ทำได้หลังจบเส้นทางแรก ลำดับสลับกันได้ถ้าไม่ได้รอกัน

- [x] `stop-and-restart`: Stop และปิด Turn ที่ค้างเมื่อเริ่มใหม่ (ADR 0017, 0033)
- [x] `one-writer-queue`: คิวงานและคนเขียนทีละ Turn (ADR 0011)
- [x] `provider-keys-in-app`: ใส่ key ของ Provider ในแอปครั้งเดียวแล้วเข้ารหัสแบบ sealed box ให้แต่ละ Machine เลือกได้จากรายชื่อ Provider ที่เราตั้งค่าไว้ให้แล้ว (URL, header และค่าเฉพาะของแต่ละเจ้า เช่น `x-opencode-session` ของ OpenCode Go) หรือเพิ่ม Provider เองด้วย URL ที่รับ Anthropic Messages API (ADR 0005, 0042)
- [x] `agent-settings`: แก้ Agent หลังสร้างด้วย `agent.update` ที่เซ็นแล้ว ทั้ง Provider, model และหน้าตา Character (ADR 0006, 0042)
- [x] `device-rename`: เปลี่ยนชื่อ Controller หลัง Link จากช่องในหน้า เครื่องของฉัน (เลื่อนจาก `linking-and-revocation`)
- [x] `delete-agent`: ลบ Agent จากแอปพร้อมยืนยัน และตัดสินว่า Workdir กับ Task เดิมลบทิ้งหรือเก็บไว้ รอ `agent-settings` (ต้องเรียก `taskRoutes.forget` ของ Task ที่ลบ ด้วย ไม่ให้บรรทัด Provider/model ของ Task ค้าง)
- [x] `runtime-service`: ติดตั้ง supervisor เป็น service ของระบบ (launchd บน macOS, systemd บน Linux) ให้ Agent ทำงานต่อหลังปิด terminal หรือเปิดเครื่องใหม่
- [x] `daily-budget`: Budget ต่อวันที่ proxy (ADR 0043)
- [x] `usage-history`: ประวัติการใช้ token 30 วันและหน้า "การใช้ token" (ADR 0066)
- [x] `memory-and-compaction`: Memory และการย่อ context (ADR 0036, 0041) — อ่าน Memory บน Machine ด้วย `veeloe memory <agent>`
- [x] `memory-writes`: tool `memory` สำหรับเขียน `MEMORY.md`/บันทึกรายวัน และ flush ก่อน compaction (ADR 0036, 0041) — การสรุป daily note เข้า `MEMORY.md` ด้วย Schedule รอ v0.2
- [ ] `agent-memory-page`: หน้า Memory ใน Controller ที่อ่าน `MEMORY.md` ของ Agent จากมือถือ (ADR 0036) — ร่าง change ไว้แล้วใน `openspec/changes/agent-memory-page/`
- [x] `attachments`: ส่งไฟล์เป็นก้อนผ่าน Hub โดยไม่เก็บ (ADR 0050)
- [ ] `push-notifications`: push ของ Approval, Turn ที่เสร็จ, Budget และการ Link เครื่องใหม่ (ADR 0044) — ตอนนี้การ Link แจ้งด้วย alert ในแอปไปก่อน
- [x] `linking-and-revocation`: Linking เครื่องที่สองด้วย QR และการถอนกุญแจ (ADR 0013, 0031)
- [x] `controller-task-screens`: Inbox, หน้า Task และ Character บนข้อมูลจริง
- [x] `logs-and-machine-status`: log ที่ไม่มีเนื้อหาและสถานะของ Machine (ADR 0052)
- [ ] ลองบน iPhone จริงและ Linux จริงตาม #31 ก่อนออก v0.1

## เวอร์ชันถัดไป

ยังไม่แตกเป็น change จนกว่าจะใกล้ถึงคิว ขอบเขตเต็มอยู่ใน ADR 0048

- **v0.2 Agent ทำงานเองได้มากขึ้น**: Schedule, Idle Work, Watch, เส้นร้อย Task, เว็บ, Skill, Connector, Library และ `agent-trash` (การกู้คืน Agent ที่ลบภายใน 30 วัน — ทำแล้วและ archive เป็น `archive/2026-11-12-agent-trash`)
  - **Harness ของงานเชิงรุก**: trigger ภายในที่ supervisor สร้างตกลงแล้ว (ADR 0067) แต่ก่อน implement ต้องปิดรายละเอียดเหล่านี้ให้ครบ: การจบ Turn แบบไม่แจ้งใครและ Task ไม่ขึ้น Inbox; การข้ามรอบเมื่อ Agent ไม่ว่าง (ไม่ต่อคิว); Approval ใน Turn ที่ไม่มีคนอยู่ (จดแล้วข้าม ไม่รอ 1 ชั่วโมง); เพดานเวลาของงาน Idle Work หนึ่งชิ้นและมาร์กไม่เสร็จ; catch-up ครั้งเดียวตอนเปิดเครื่องพร้อมบอกเวลาที่ควรรัน; source และเพดาน 30% ของ Idle+Watch (ADR 0043, 0066); การรวม event ที่ถี่ของ Watch และไม่นับการเขียนของ Agent เอง; และ Task/visibility ของงานที่ไม่มี Member ส่งข้อความ (ADR 0060)
- **v0.3 องค์กรและเปิดให้คนอื่นใช้**: เริ่มจาก E2E แล้วตามด้วยการแยกสิทธิ์ของหลาย Member, รูปโปรไฟล์ของ Member ที่เก็บบน Runtime (ADR 0053), **การย้าย Machine ไป Workspace ใหม่ด้วยการปล่อยแล้ว Pairing ใหม่ (ADR 0035)**, **Egress แยกต่อ Agent พร้อมโหมดทั้งเน็ต (ADR 0029) ซึ่งต้องมาพร้อมหรือก่อน Member คนที่สองและก่อน Channel** และชุดเปิดตัว ได้แก่ Runtime ที่อัปเดตตัวเองจาก release ที่เซ็นแล้ว พร้อม manifest ที่เซ็นและสคริปต์ติดตั้งที่ตรวจลายเซ็นแบบเดียวกัน (ADR 0009), `veeloe backup` กับ `restore` (ADR 0051), Demo Workspace กับการลบบัญชี (ADR 0024) และการเก็บเงินพร้อมโควตาตอน Pairing (ADR 0001)
- **v0.4 Project และ Team**: Project, Team, Ask, Mention, Worktree และหลาย Turn พร้อมกัน (ADR 0064)
- **v0.5 Channel**: Telegram และ `/claim`
