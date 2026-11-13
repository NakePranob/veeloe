## Why

issue #43 (ชิ้นที่ 4 ของ #32): proxy ตัวเดียวทั้ง Machine ไม่รู้ว่าคำขอมาจาก Agent ไหน และ Egress เป็นรายชื่อเดียวทั้งเครื่อง Agent หนึ่งจึงใช้โดเมนที่อีก Agent ได้ และการอนุมัติต่อโดเมนในชิ้นถัดไปผูกกับ Agent/Member ไม่ได้

## What Changes

- proxy เปิด listener ต่อ Agent ผูกกับ Agent นั้น; worker ใช้ port/socket ของตัวเอง และ profile เปิดเฉพาะทางนั้น
- Egress ย้ายไปเก็บที่ Agent; migrate รายชื่อเดิมของ Machine ให้ทุก Agent ครั้งเดียว
- `egress.set` ระบุ Agent ได้และตรวจสิทธิ์ Manage ที่ Agent นั้น; แบบไม่ระบุ Agent ยังทำงานแบบเดิม (ทุก Agent) จนกว่า Controller จะมี UI ต่อ Agent
- `agent.listed` มี Egress ของ Agent แต่ละตัว และยังมี `egress` รวมแบบเดิมให้ Controller รุ่นก่อนอ่านได้

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: proxy และ Egress ต่อ Agent
- `machine-egress`: Egress เป็นของ Agent และการแก้ต้องมีสิทธิ์ Manage

## Impact

- `runtime-core`: Agent มี Egress, policy ต่อ Agent
- `runtime-supervisor`: proxy ต่อ Agent, storage/migration, `egress.set`/`agent.listed`, สิทธิ์
- test: สอง Agent Egress ต่างกัน, migration, สิทธิ์, macOS + Linux
