# Spec Delta

## ADDED Requirements

### Requirement: agent.create รับ Allowlist เริ่มต้น
`agent.create` SHALL มี field `allowlist` ที่ไม่บังคับ เป็นรายการ string ของคำนำหน้าคำสั่งกับชื่อ tool supervisor SHALL เก็บตามที่ส่งมาโดยตรวจว่าเป็นรายการ string ที่ไม่ว่างเปล่า Agent ที่สร้างโดยไม่มี field นี้ SHALL เริ่มจาก Allowlist ว่าง คำสั่งสร้างซ้ำด้วยรหัสเดิม SHALL ไม่เปลี่ยน Allowlist ที่เก็บไว้

#### Scenario: สร้างพร้อม Allowlist
- **WHEN** Owner ส่ง `agent.create` ที่มี `allowlist` เป็น `["ls", "pwd", "cat"]`
- **THEN** Agent ใหม่มี Allowlist นั้น

#### Scenario: สร้างโดยไม่ส่ง
- **WHEN** Owner ส่ง `agent.create` ที่ไม่มี `allowlist`
- **THEN** Agent ใหม่มี Allowlist ว่าง

#### Scenario: ส่งซ้ำ
- **WHEN** คำสั่งสร้างด้วยรหัสเดิมมาถึงอีกครั้งพร้อม `allowlist` อื่น
- **THEN** Allowlist เดิมไม่เปลี่ยน

### Requirement: agent.listed ส่ง Allowlist ของแต่ละ Agent กลับไป
`agent.listed` SHALL มี `allowlist` ใน Agent แต่ละตัว เป็นรายการที่เก็บไว้ Controller รุ่นเก่า SHALL ข้าม field นี้ได้ตาม ADR 0023

#### Scenario: ขอรายชื่อ
- **WHEN** Controller ขอรายชื่อ Agent
- **THEN** Agent แต่ละตัวมี `allowlist` ที่ตรงกับที่เก็บไว้
