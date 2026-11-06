# Proposal

## Why

Agent รันคำสั่ง `bash` ใน Workdir ได้แล้ว (change `sandboxed-commands`) แต่การอ่านและแก้ไฟล์ผ่าน shell อย่างเดียวเปลือง Turn และพลาดง่าย: อ่านไฟล์ยาวต้องแบ่งเอง แก้ไฟล์ต้องส่ง `sed` ที่พังเมื่อมีอักขระพิเศษ และค้นหาไฟล์ต้องประกอบคำสั่งเองทุกครั้ง ADR 0011 ยังกำหนดให้ Subagent อนาคตอ่านได้อย่างเดียวด้วยชุด tool `read`, `glob` และ `grep` ซึ่งยังไม่มี

## What Changes

- เพิ่ม tool สำหรับ Workdir ใน worker: `read`, `write`, `edit`, `glob` และ `grep` ทำงานใน sandbox เดียวกับ worker (ADR 0008) และจำกัด path ให้อยู่ใน Workdir ของ Agent (ADR 0032)
- `read` อ่านไฟล์พร้อมเลขบรรทัด รองรับ `offset`/`limit` และตัดไฟล์ที่ใหญ่เกินขอบเขต
- `write` เขียนไฟล์ใหม่แบบ atomic สร้างโฟลเดอร์พ่อให้ และ `edit` แทนข้อความที่ตรงทั้งหมดโดยต้องเจอครั้งเดียว เว้นแต่ขอ `replace_all`
- `glob` หาไฟล์ตาม pattern และ `grep` ค้นข้อความ/ regex ในไฟล์ พร้อมเพดานผลลัพธ์และข้าม `.git`, `node_modules`, ไฟล์ไบนารี
- `fileTools({ workdir, readOnly })` ให้ Subagent อนาคตได้เฉพาะ `read`, `glob`, `grep` ตาม ADR 0011 โดยไม่ต้องมีชุด tool ที่สอง
- รวม `bash` กับ file tools เป็น `ToolRunner` เดียวใน `worker/index.ts` ด้วยตัวประกอบกลาง

## Capabilities

### New Capabilities

- `file-tools`: ชุด tool อ่าน เขียน แก้ไข ค้นไฟล์และค้นข้อความใน Workdir รวมถึงโหมดอ่านอย่างเดียวสำหรับ Subagent

### Modified Capabilities

ไม่มี — `bash-tool` ยังทำงานเหมือนเดิมและไม่ถูกแก้

## Impact

- **Runtime:** `packages/runtime/src/worker/adapters/files.ts` ใหม่, `worker/adapters/tools.ts` สำหรับประกอบ runner, `worker/index.ts` ต่อ tool เข้ากับ Agent
- **Protocol / Hub / Controller:** ไม่แตะ — tool ทำงานใน worker และผลลัพธ์ไปกับ event `tool.result` เดิม
- **Dependency ใหม่:** ไม่มี — ใช้ `Bun.Glob`, `node:fs` และ `node:path`; ไม่เรียก `rg` หรือ `grep` ภายนอก
- **ADR:** อ้าง ADR 0008 (sandbox), 0011 (หนึ่งผู้เขียนและ Subagent อ่านอย่างเดียว) และ 0032 (Workdir ที่ Runtime สร้าง) โดยไม่ต้องมี ADR ใหม่

## Non-Goals

- Tool สำหรับอ่านนอก Workdir — `bash` ยังเป็นทางเดียวที่ sandbox อนุญาตตาม ADR 0008
- Approval หรือ Allowlist สำหรับการเขียนไฟล์ (change `approval-and-allowlist`)
- Subagent จริงและการ delegate — change นี้แค่เตรียม `readOnly`
- Patch แบบหลายไฟล์ในครั้งเดียว, rename, delete, move หรือ diff viewer
- การล็อกไฟล์ข้ามโปรเซส — ADR 0011 ให้ Agent ทำทีละ Turn อยู่แล้ว
