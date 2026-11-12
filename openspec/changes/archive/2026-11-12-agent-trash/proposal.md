## Why

`delete-agent` ปิดไปแล้วด้วยการลบถาวรจากรายการ: Runtime ลบแถวออกจาก `agents.json`, Controller ลบแถว local ตาม `agent.listed` และ Worker ของ Agent นั้นหยุดทันที Workdir กับ `tasks.db` ยังอยู่บนดิสก์ แต่**ไม่มีทางกลับเข้าไปใช้ข้อมูลนั้นได้จากแอปเลย** เพราะ Controller สร้าง id ใหม่ทุกครั้ง (`randomUUID` ใน `controller/src/features/machine-link/model/links.ts`) และ Runtime ไม่มีคำสั่งสร้าง Agent ด้วย id ที่ผู้ใช้กำหนด ดังนั้น acceptance anchor "สร้างใหม่ด้วย id เดิมได้" ใน spec เดิมไม่ใช่ทางที่ผู้ใช้จริงทำได้

ผลคือการกดลบผิดครั้งเดียวทำให้เสียทั้ง settings ของ Agent (Provider, model, Character, Allowlist, Approval timeout, Budget) และทางเข้าถึง Task history ที่ยังอยู่บนดิสก์ ทั้งที่ผลิตภัณฑ์มี idiom "ลบแล้วรอ 30 วันก่อนลบจริง" อยู่แล้วสำหรับบัญชี (ADR 0024)

## What Changes

- Runtime เก็บแถวของ Agent ที่ถูกลบไว้ใน `agents.json` พร้อม `deletedAt` แทนการลบทันที; Worker หยุดเหมือนเดิม
- `agent.listed` แยกสองรายการ: `agents` มีเฉพาะ Agent ที่ใช้งานอยู่ (เหมือนเดิมทุกไบต์) และ `trash` มี Agent ที่ถูกลบพร้อม `deletedAt` กับ `restoreUntil`; Controller รุ่นเก่าที่ไม่รู้จัก `trash` จึงเห็นพฤติกรรมเดิม
- เพิ่มข้อความ `agent.restore` (`{ id }`) สำหรับกู้คืนภายใน 30 วัน; กู้คืนแล้ว Worker เริ่มใหม่และ Agent กลับไปอยู่ใน `agents`
- Runtime คำนวณวันหมดอายุจาก `deletedAt` ตอนอ่านรายการ ไม่มี timer; เกิน 30 วันแล้วตัดแถวออกจาก `agents.json` (purge) โดยไม่แตะ Workdir และ Task history
- Runtime ไม่สตาร์ท Worker ของ Agent ที่อยู่ในถังขยะตอนเปิด service และไม่ให้ proxy ของ Provider รับงานจาก Agent นั้น
- Controller เก็บถังขยะในตาราง local `agent_trash` แยกจากตาราง `agent` และแสดง section "Agent ที่ถูกลบ" ใต้รายการ Agent พร้อมวันเหลือและปุ่มกู้คืน
- หน้า Task ของ Agent ที่อยู่ในถังขยะยังอ่านได้เหมือนเดิม และแสดงชื่อจริงของ Agent แทนข้อความกลาง ๆ

## Capabilities

### New Capabilities

- `agent-trash`: การเก็บ Agent ที่ลบไว้ 30 วัน การกู้คืน และการ purge

### Modified Capabilities

- `agent-deletion`: การลบ Agent ไม่ลบแถวออกจาก registry ทันที และรายการที่ส่งให้ Controller แยก Agent ที่ใช้งานอยู่ออกจาก Agent ที่ถูกลบ

## Non-goals

- ไม่ลบหรือย้าย Workdir และ Task history ทั้งตอนลบ ตอน purge และตอนกู้คืน
- ไม่กู้คืน Task route ของ Turn ที่ค้างอยู่ (route ถูก forget ตอนลบเหมือนเดิม; Task ใหม่หรือการคุยต่อจะ pin route ใหม่)
- ไม่มีหน้า Agent ที่ถูกลบแยกต่างหาก และไม่เปิดหน้า Agent ในถังขยะให้แก้ setting
- ไม่เปลี่ยน Inbox ให้แสดง Agent ที่ถูกลบ (Inbox ยังมีเฉพาะ Agent ที่ใช้งานอยู่)
- ไม่เปลี่ยนหน้าต่าง 30 วันของการลบบัญชี (ADR 0024)
- Hub ไม่เปลี่ยน; ส่งต่อ envelope ตามปกติ

## Decisions needed before implementation

- **ประวัติการใช้ token ของ Agent ที่ถูกลบ**: หน้า "การใช้ token" อ่านจากรายการ Agent ที่ใช้งานอยู่ ถังขยะจึงทำให้ประวัติของ Agent ที่ถูกลบหายจากหน้านี้ — ข้อเสนอคือยอมให้หายก่อน แล้วค่อยเปิด change แยกถ้าต้องการดูย้อนหลัง
- **ชื่อในหน้า Task**: ข้อเสนอคือใช้ชื่อจริงจาก `agent_trash` และคง read-only ไว้ จนกว่าจะมีหน้า Agent ที่ถูกลบ
- **การจัดเข้า v0.2**: change นี้อยู่นอกลิสต์เดิมของ v0.2 ใน ADR 0048 จึงต้องแก้ ADR 0048 กับ `docs/roadmap.md` ในงานนี้ (ผู้ใช้ยืนยันแล้วว่าให้จัดคิวหลัง v0.1)

## Impact

- **Protocol (TS + Rust):** `AgentListBodySchema` ไม่เปลี่ยน; `AgentListedBodySchema` เพิ่ม `trash` แบบ optional; เพิ่ม `AgentRestoreBodySchema` และ type `agent.restore`
- **Runtime:** `agents.rs` (`deleted_at`, `soft_delete`, `restore`, `purge_expired`), `tasks.rs` (`agents_listed`, `agent.delete`, `agent.restore`, กัน `task.message` ไปยัง Agent ในถังขยะ), `main.rs` (ข้าม Worker ตอน boot, proxy ปฏิเสธ Agent ในถังขยะ, purge ตอน boot)
- **Controller:** migration ตาราง `agent_trash`, `saveAgents`, `useTrashedAgents`, `links.restoreAgent`, `AgentsPage`, `TaskPage`, i18n th/en
- **Docs:** `docs/adr/0048-five-phases-with-v0-1-as-the-mvp.md` (ขอบเขต v0.2), `docs/roadmap.md`

## Acceptance anchor cases

- Owner ลบ Agent ที่มี Task history → Agent หายจากรายการหลัก ไปอยู่ในถังขยะ พร้อมวันเหลือ 30 วัน และ Task เดิมยังเปิดอ่านได้
- ปิด/เปิดแอปใหม่หลังลบ → Agent ยังอยู่ในถังขยะ ไม่กลับไปรายการหลักและไม่หายไปจากถังขยะ
- กดกู้คืนภายใน 30 วัน → Agent กลับไปรายการหลักพร้อม settings เดิม และ Task เดิมคุยต่อได้
- ปล่อยเกิน 30 วัน → Agent หายจากถังขยะ, `agent.restore` ได้ `agent.unknown`, และ Workdir กับ Task history ยังอยู่บนดิสก์
- Controller รุ่นเก่าที่ไม่รู้จัก `trash` กับ Runtime รุ่นใหม่ → Agent ที่ลบแล้วหายจากรายการเหมือนพฤติกรรมเดิม
- Runtime ถูกปิดและเปิดใหม่ระหว่างที่ Agent อยู่ในถังขยะ → Worker ของ Agent นั้นไม่ถูกสตาร์ท
