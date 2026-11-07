# Design

## Context

ดู `proposal.md` ว่าทำไมต้องมี Approval กับ Allowlist ส่วนนี้บอกแค่ว่าของเดิมหน้าตาเป็นอย่างไรและทางที่เลือกเดินต่อจากของเดิมอย่างไร

- Protocol มี `agent.create` / `agent.update` / `agent.listed` อยู่แล้ว (ดู `packages/protocol/src/messages/agent.ts`) และมี `TaskEventKind` ห้าตัวใน `task.ts` — งานนี้เพิ่ม field กับชนิดข้อความ ไม่รื้อของเดิม (ADR 0023)
- supervisor เก็บ Agent ใน `agents.json` ผ่าน `AgentRegistry` (`packages/runtime/src/supervisor/agent-registry/registry.ts`) และตอบ `agent.listed` ผ่าน slice `agents.ts` — Allowlist เป็น field ใหม่ใน record เดิม
- worker รัน Turn ใน `packages/runtime/src/worker/core/agent.ts` เรียก tool ผ่าน `ToolRunner` (`bash.ts` รันคำสั่งจริง) — guard อยู่ก่อนเรียก `tools.run` ไม่ได้อยู่ใน `bash.ts` เพราะ `bash.ts` ไม่รู้ Allowlist
- supervisor กับ worker คุยกันทาง IPC (`packages/runtime/src/ipc.ts`) มี `ToWorker` / `FromWorker` อยู่แล้ว — คำตอบ Approval เป็นชนิดใหม่ในท่อเดิม
- Controller เป็น Expo แยกหน้าตาม feature ใน `controller/src` มี i18n แยกไฟล์ TH/EN ต่อหน้าและมี `check-i18n` ใน CI (ADR 0065)

## Goals / Non-Goals

**Goals:**
- คำสั่งนอก Allowlist หยุดรอคนตอบก่อนรันเสมอ ไม่มีทางลัด
- Allowlist แก้ได้จากแอปและมีผลกับคำขอถัดไปโดยไม่เริ่ม worker ใหม่
- Controller รุ่นเก่ากับ Machine รุ่นเก่าคุยกันได้ตาม ADR 0023 (field ใหม่ไม่บังคับ ข้าม kind ที่ไม่รู้จัก)

**Non-Goals:**
- ไม่ทำคิวงาน (`one-writer-queue` ทำต่างหาก) — ระหว่างรอ Approval ข้อความใหม่ยังได้ `agent.busy` เหมือนเดิม
- ไม่แตะ tool ไฟล์ ไม่แตะ Egress ไม่แตะปุ่ม Stop (`stop-and-restart` ทำต่างหาก)
- ไม่ทำ push notification ของ Approval (`push-notifications` ทำต่างหาก)

## Decisions

### 1. Allowlist เป็น field ใน record ของ Agent ไม่ใช่ไฟล์แยก
เก็บ `allowlist: string[]` ใน `Agent` ของ protocol กับใน `agents.json` บรรทัดเดียวกับการแก้ `character` กับ `budget` ที่ทำมาก่อน ทางเลือกคือไฟล์ `allowlist.json` แยกต่อ Agent — ไม่เอาเพราะต้อง sync สองไฟล์ตอนสร้าง/ลบ และการส่ง `agent.listed` ต้องอ่านหลายที่

### 2. guard อยู่ใน worker core ก่อนเรียก tool ไม่ได้อยู่ใน bash adapter
`createAgentCore` เช็คว่า `use.name === "bash"` แล้วส่ง `command` ผ่านตัวแยกท่อนกับเทียบคำนำหน้า ถ้าไม่ผ่านให้เขียน `approval.requested` แล้วแขวน promise ของ tool call นั้นไว้จน supervisor ส่งคำตอบกลับมาทาง IPC ทางเลือกคือเช็คใน `bash.ts` — ไม่เอาเพราะ adapter ไม่มีทางเขียน event ลง log และไม่รู้ว่าต้องหยุด Turn อย่างไร

### 3. คำขอรออยู่ใน worker หน่วยความจำ ไม่ใช่ฐานข้อมูล
`approval.requested` อยู่ใน log แล้วเลยกู้ state ได้ แต่ promise ที่แขวนไว้อยู่กับ worker process ถ้า worker พังกลางรอ Turn จบเหมือนโดน Stop (ตามกฎ `restart-ends-open-turns` ในอนาคต) แล้ว Member ส่งข้อความใหม่ได้ ทางเลือกคือเก็บคำขอค้างใน DB แล้วรันต่อหลัง restart — ไม่เอาเพราะซับซ้อนและขัดกับกฎว่า Turn ที่ค้างจบเมื่อเริ่มใหม่

### 4. `approval.answer` ซองเดียวพาทั้งคำตอบและคำนำหน้าอนุญาตตลอด
คำตอบครั้งเดียว (อนุมัติ/ปฏิเสธ/บอกให้ทำอย่างอื่น) ไปทาง `approval.answer` ซึ่งมี field `allowAlways` ที่ไม่บังคับสำหรับปุ่มอนุญาตตลอด supervisor ตรวจ Approve ก่อนทุกครั้ง แล้วตรวจ Manage เพิ่มเฉพาะเมื่อมี `allowAlways` (ไม่ผ่านส่วนนี้ซองทั้งซองถูกทิ้ง) ทางเลือกคือแยกสองซอง (`approval.answer` กับ `agent.update`) — ไม่เอาเพราะสองอย่างนี้ต้องสำเร็จหรือล้มไปด้วยกัน และการตรวจสองชั้นในซองเดียวอ่านง่ายกว่า

### 5. ตัวแยกท่อนอยู่ใน protocol package ให้ runtime กับ test ใช้ร่วมกัน
ฟังก์ชัน `splitCommand` กับ `matchesAllowlist` อยู่ใน `packages/protocol` (หรือ `packages/runtime` ถ้าไม่อยากให้ protocol มี logic) เพื่อให้ unit test ตรวจกฎความปลอดภัยที่เดียวกัน ทางเลือกคือเขียนแยกใน worker อย่างเดียว — ไม่เอาเพราะ Controller ต้องใช้กฎเดียวกันตอนเสนอท่อนที่ยังไม่อยู่ในรายการบนปุ่มอนุญาตตลอด ถ้าเขียนสองที่จะเพี้ยนกัน

### 6. Controller เสนอเฉพาะท่อนที่ยังไม่อยู่ในรายการ
ตาม ADR 0030 ปุ่มอนุญาตตลอดเสนอคำสั่งเต็มบรรทัด Member ตัดท้ายได้ และแอปบอกว่าครอบคำสั่งไหน ถ้าคำสั่งมีหลายท่อนเสนอเฉพาะท่อนที่ยังไม่อยู่ในรายการ ทางเลือกคือเสนอทั้งบรรทัดเป็นรายการเดียว — ไม่เอาเพราะจะได้รายการที่กว้างเกินและขัดกับ ADR

## Risks / Trade-offs

- [Risk] รายการ `git push` ครอบ `git push --force` ด้วย → Mitigation: หน้า Allowlist เตือนเมื่อรายการที่เพิ่มครอบคำสั่งอันตราย และให้ตัดให้แคบได้ก่อนเซ็น (ตาม ADR 0030)
- [Risk] LLM ขอคำสั่งยาวหลายท่อนแล้วขอ Approval ทั้งบรรทัด แต่ Member อนุมัติแค่ครั้งเดียว → Mitigation: อนุมัติมีผลเฉพาะคำขอนั้น ไม่เพิ่ม Allowlist ยกเว้นกดอนุญาตตลอด
- [Risk] หมดเวลา 1 ชั่วโมงแล้ว worker ยังแขวนอยู่ → Mitigation: ตั้ง timer ต่อคำขอ ครบแล้วเขียน `approval.answered` ว่า `expired` ส่ง error ให้ LLM แล้วจบการรอ
- [Trade-off] Allowlist กันความผิดพลาดไม่ใช่กำแพง (ADR 0030) — เอกสารกับ UI ต้องไม่พูดว่า Allowlist ป้องกัน Agent ที่โดนหลอกได้

## Migration Plan

- Machine เก่าที่ `agents.json` ไม่มี `allowlist` ถือว่า Allowlist ว่าง (เหมือน Agent ที่สร้างก่อนมี field ใหม่ ตามแบบ `character` กับ `budget`)
- Controller เก่าที่ไม่ส่ง `allowlist` ใน `agent.create` ได้ Agent ที่ Allowlist ว่าง Controller เก่าเห็น `agent.listed` ที่มี `allowlist` แล้วข้ามไป
- ไม่มี migration ของฐานข้อมูล Task — event kind ใหม่แค่เพิ่ม ไม่แตะ event เดิม

## Open Questions

- ไม่มี — ตัดสินตอน implement แล้ว: เวลาหมดอายุเป็น field ต่อ Agent (`approvalTimeoutS` เป็นวินาที 60–86400 ค่าเริ่มต้น 3600) เก็บใน record ของ Agent ส่งผ่าน `agent.listed` ไปถึง worker ทาง IPC กับ env และตั้งได้จากหน้า Allowlist หน่วยเป็นนาที มีผลกับคำขอถัดไปโดยไม่ตัดคำขอที่รออยู่
