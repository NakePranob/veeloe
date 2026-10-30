# แบ่งงานเป็นห้า phase และ v0.1 คือ MVP ที่ Owner คนเดียวสั่ง Agent บนเครื่องตัวเองจากมือถือ

ADR ตั้งแต่ 0001 ถึง 0047 ออกแบบไว้มากกว่าที่ต้องสร้างก่อนเปิดให้คนใช้ ถ้าไม่ตัดขอบเขต ticket ชุดใหม่จะไม่มีลำดับ และ v0.1 จะไม่มีวันเสร็จ เราจึงแบ่งตามลำดับที่เรื่องหนึ่งต้องพึ่งอีกเรื่อง v0.1 ต้องพิสูจน์แค่ว่าสั่ง Agent บนเครื่องตัวเองจากมือถือได้อย่างปลอดภัย และไม่เสียเงินเกินที่คิด ส่วนที่เหลือเพิ่มทีหลังได้แบบ additive (ADR 0023)

1. **v0.1 (MVP)**: Pairing, Linking เครื่องที่สองและการถอนกุญแจ (ADR 0031), สร้าง Agent และคุยใน Task, Attachment (ADR 0050), Approval, Stop, Allowlist, sandbox บน macOS และ Linux กับ Egress รายชื่อเดียวทั้ง Machine (ADR 0008), Provider ที่ตั้งบน Machine พร้อม proxy และ Budget (ADR 0042, 0043), Memory กับ compaction (ADR 0036, 0041), push ของ Approval, Runtime ที่อัปเดตตัวเองแบบเซ็น (ADR 0009), Controller แบบ local-first พร้อม Character, `veeloe backup` กับ `restore` (ADR 0051), log และสถานะของ Machine (ADR 0052) และถ้าส่งขึ้น App Store ต้องมี Demo Workspace กับการลบบัญชี (ADR 0024) v0.1 มี Member คนเดียวคือ Owner
2. **v0.2 Agent ทำงานเองได้มากขึ้น**: Schedule, `web_fetch` และการค้นเว็บ, Skill, Connector และ Library
3. **v0.3 องค์กร**: Invitation, Owner หลายคน, Grant ให้ Member คนอื่น, การเลือกผู้รับจาก Grant และการย้าย Machine และต้องมี E2E ใน phase นี้ เพราะ ADR 0005 และ 0034 ให้ E2E เสร็จก่อนเปิดให้คนอื่นใช้
4. **v0.4 Project**: Project, Ask, Mention, Worktree และ Agent ที่รันหลาย Turn พร้อมกัน ไว้หลังสุดของงานแกน เพราะเปลี่ยน Runtime จาก worker ต่อ Agent เป็น worker ต่อ Turn (ADR 0020, 0047)
5. **v0.5 Channel**: Telegram และ Egress แยกต่อ Agent (ADR 0028, 0029) Channel ไม่ต้องรอ Project ถ้าต้องการเร็วกว่านี้ ยกไปไว้หลัง v0.2 ได้

marketplace ของ Blueprint (ADR 0049) มาหลัง v0.3

## Considered Options

- **v0.1 มี Schedule หรือ Channel ด้วย**: จุดขายชัดกว่าตั้งแต่วันแรก แต่ทั้งสองอย่างทำงานโดยไม่มีคนกด จึงต้องมี Budget, sandbox และ Approval ที่นิ่งแล้วก่อน
- **ทำองค์กรก่อน Agent ทำงานเอง**: ขายให้บริษัทได้เร็วกว่า แต่ต้องรอ E2E ซึ่งเป็นงานใหญ่ ในขณะที่ v0.2 ใช้ได้กับ Owner คนเดียว
- **ทำ Project ก่อนองค์กร**: Project ใช้กับ Owner คนเดียวได้ แต่เปลี่ยนโครง Runtime มากที่สุด ถ้าทำก่อน งานของ v0.2 และ v0.3 ต้องสร้างบนโครงที่ยังไม่นิ่ง

## Consequences

- ADR ที่เขียนว่าอะไรไม่อยู่ใน v0.1 ยังถูกอยู่ ADR นี้เพิ่มแค่ว่าแต่ละเรื่องอยู่ phase ไหน
- ข้อมูลต้องเตรียมไว้รองรับ phase ถัดไปตั้งแต่ v0.1 เช่น เก็บ Owner และ Member เป็นรายชื่อ (ADR 0010, 0031) แม้จะมีคนเดียว
- ticket ชุดใหม่ (`/to-tickets`) แบ่งตาม phase นี้
