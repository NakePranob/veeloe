## Context

proxy วันนี้เป็นตัวเดียวทั้ง Machine (`proxy::start` ครั้งเดียวใน `main`) และ Egress อยู่ใน `runtime/egress.json` ระดับเครื่อง Agent ทุกตัวจึงใช้รายการเดียวกันและ proxy ไม่รู้ว่าคำขอมาจาก Agent ไหน

## Decisions

**proxy ต่อ Agent:** supervisor เปิด listener หนึ่งตัวต่อ Agent (TCP loopback บน macOS, Unix socket ใต้โฟลเดอร์ Agent บน Linux) และส่ง URL/socket ให้ worker ตัวนั้นเท่านั้น profile เปิดเฉพาะ port/socket ของ Agent นั้น; toolchain check ใช้ policy เดียวกัน

**Egress เก็บที่ Agent:** เพิ่ม field ใน Agent (ค่าเริ่มต้นว่าง) และ migrate รายชื่อ Machine เดิมให้ทุก Agent ครั้งเดียวด้วย flag file แบบเดียวกับ `usage.json.migrated`; คง `egress.json` ไว้เป็นมุมมองรวมให้ Controller รุ่นก่อน

**`egress.set` ระบุ Agent:** ถ้ามี `agent` ต้องมีสิทธิ์ Manage ที่ Agent นั้น (v0.1: Owner ที่ผูกแล้ว) และแก้เฉพาะ Agent นั้น; ถ้าไม่ระบุ ให้มีผลทุก Agent เหมือนเดิมจนกว่า UI จะย้าย

**`agent.listed`:** แต่ละ Agent มี `egress` ของตัวเอง และ top-level `egress` ยังเป็นรายการรวมเพื่อความเข้ากันได้

## Risks

- proxy ต่อ Agent เพิ่ม listener ตามจำนวน Agent → ปิดเมื่อ worker หยุด
- Egress รวมแบบเดิมอาจทำให้ UI โชว์ผิดระหว่างเปลี่ยน → ระบุใน proposal และทำ UI แยก
