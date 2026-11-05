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
- [ ] `workdir-file-tools`: tool อ่านและเขียนไฟล์ใน Workdir (read, write, edit, glob, grep) รอ `sandboxed-commands` (ADR 0008, 0011, 0032)
- [ ] `approval-and-allowlist`: ขอและตอบ Approval พร้อม Allowlist รอ `sandboxed-commands` (ADR 0030)

### ส่วนที่เหลือของ v0.1

ทำได้หลังจบเส้นทางแรก ลำดับสลับกันได้ถ้าไม่ได้รอกัน

- [ ] `stop-and-restart`: Stop และปิด Turn ที่ค้างเมื่อเริ่มใหม่ (ADR 0017, 0033)
- [ ] `one-writer-queue`: คิวงานและคนเขียนทีละ Turn (ADR 0011)
- [ ] `provider-keys-in-app`: ใส่ key ของ Provider ในแอปครั้งเดียวแล้วเข้ารหัสแบบ sealed box ให้แต่ละ Machine เลือกได้จากรายชื่อ Provider ที่เราตั้งค่าไว้ให้แล้ว (URL, header และค่าเฉพาะของแต่ละเจ้า เช่น `x-opencode-session` ของ OpenCode Go) หรือเพิ่ม Provider เองด้วย URL ที่รับ Anthropic Messages API (ADR 0005, 0042)
- [ ] `agent-settings`: แก้ Agent หลังสร้างด้วย `agent.update` ที่เซ็นแล้ว ทั้ง Provider, model และหน้าตา Character (ADR 0006, 0042)
- [ ] `delete-agent`: ลบ Agent จากแอปพร้อมยืนยัน และตัดสินว่า Workdir กับ Task เดิมลบทิ้งหรือเก็บไว้ รอ `agent-settings`
- [ ] `runtime-service`: ติดตั้ง supervisor เป็น service ของระบบ (launchd บน macOS, systemd บน Linux) ให้ Agent ทำงานต่อหลังปิด terminal หรือเปิดเครื่องใหม่
- [ ] `daily-budget`: Budget ต่อวันที่ proxy (ADR 0043)
- [ ] `memory-and-compaction`: Memory และการย่อ context (ADR 0036, 0041)
- [ ] `attachments`: ส่งไฟล์เป็นก้อนผ่าน Hub โดยไม่เก็บ (ADR 0050)
- [ ] `push-notifications`: push ของ Approval, Turn ที่เสร็จ และ Budget (ADR 0044)
- [ ] `linking-and-revocation`: Linking เครื่องที่สองด้วย QR และการถอนกุญแจ (ADR 0013, 0031)
- [ ] `controller-task-screens`: Inbox, หน้า Task และ Character บนข้อมูลจริง
- [ ] `logs-and-machine-status`: log ที่ไม่มีเนื้อหาและสถานะของ Machine (ADR 0052)
- [ ] ลองบน iPhone จริงและ Linux จริงตาม #31 ก่อนออก v0.1

## เวอร์ชันถัดไป

ยังไม่แตกเป็น change จนกว่าจะใกล้ถึงคิว ขอบเขตเต็มอยู่ใน ADR 0048

- **v0.2 Agent ทำงานเองได้มากขึ้น**: Schedule, Idle Work, Watch, เส้นร้อย Task, เว็บ, Skill, Connector และ Library
- **v0.3 องค์กรและเปิดให้คนอื่นใช้**: เริ่มจาก E2E แล้วตามด้วยการแยกสิทธิ์ของหลาย Member, รูปโปรไฟล์ของ Member ที่เก็บบน Runtime (ADR 0053) และชุดเปิดตัว
- **v0.4 Project และ Team**: Project, Team, Ask, Mention, Worktree และหลาย Turn พร้อมกัน (ADR 0064)
- **v0.5 Channel**: Telegram และ `/claim`
