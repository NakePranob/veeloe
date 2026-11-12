## Why

ADR 0036 วาง Memory ไว้เป็น `MEMORY.md` ที่ root ของ Workdir ซึ่ง Runtime ใส่เข้า system prompt ทุก Turn และปิดท้าย Consequences ไว้ว่า "แอปมีหน้าให้อ่าน `MEMORY.md` ได้" เพราะ Memory โดนวางยาได้ ถ้าคนหรือหน้าเว็บหลอกให้ Agent จดคำสั่งไว้ คำสั่งนั้นจะติดไปทุก Task และ Allowlist กันไม่ได้

`memory-and-compaction` ทำกลไก Memory กับ compaction จบแล้ว แต่ตั้งใจเว้นหน้าใน Controller ไว้เป็น Non-goal และเหลือไว้แค่คำสั่ง `veeloe memory <agent>` บน Machine (ปิด task 1.4 ด้วยคำสั่งนั้น) ผลคือ Owner ต้องอยู่หน้า terminal ของ Machine เพื่อตรวจว่า Agent จำอะไรอยู่ ซึ่งขัดกับเส้นทางหลักของ v0.1 ที่สั่งและตรวจงานจากมือถือ

ตามปกติ `docs/roadmap.md` ให้เปิด change เมื่อถึงคิวเท่านั้น แต่รอบนี้เปิดเลยเพราะ v0.1 เป็นเฟสที่กำลังทำอยู่ และ ADR 0036 ระบุไว้ใน Consequences แล้วว่าแอปต้องมีหน้าให้อ่าน `MEMORY.md`; หน้า Memory จึงเป็นส่วนที่ยังค้างของ v0.1 ไม่ใช่ของเวอร์ชันถัดไป

## What Changes

- เพิ่มข้อความ `memory.get` (`{ request, agent }`) จาก Controller และ `memory.got` (`{ request, agent, exists, chars, text }`) จาก Machine; `text` เป็นข้อความล้วนที่ตัดตามเพดาน 4,000 ตัวอักษรแบบเดียวกับ prompt
- Runtime ตอบจาก `MEMORY.md` ของ Agent นั้นผ่านตัวอ่านตัวเดียวกับ prompt และคำสั่ง `veeloe memory`; อ่านแล้วไม่สร้างไฟล์หรือโฟลเดอร์; Agent ที่ไม่รู้จักตอบ `agent.unknown`
- Controller เก็บคำตอบล่าสุดต่อ Agent ไว้ในหน่วยความจำของ session (ไม่ลงฐานข้อมูล) และทิ้งคำตอบที่ request ไม่ตรงกับคำขอล่าสุด
- เพิ่มหน้า `/agents/<id>/memory` ที่อ่านอย่างเดียว แสดงเนื้อหา จำนวนตัวอักษรเทียบเพดาน เวลาที่ได้ล่าสุด และปุ่มโหลดใหม่ พร้อมทางเข้าจากแถว Memory ในหน้า Agent
- ข้อความ Memory แสดงเป็นข้อความล้วน ไม่ตีความเป็น Markdown หรือ HTML

## Capabilities

### New Capabilities

- `controller-memory`: หน้า Memory ใน Controller สำหรับ Owner อ่าน `MEMORY.md` ของ Agent

### Modified Capabilities

- `agent-memory`: อ่าน Memory ของ Agent ได้ผ่านข้อความที่เซ็นแล้ว โดยใช้เพดานและตัวอ่านตัวเดียวกับ prompt

## Non-goals

- ไม่แก้ไข `MEMORY.md` จากแอปในรอบนี้; การเขียนยังเป็นของ Agent ผ่าน file tools (ADR 0036) การแก้แทน Agent จะเปิด change แยกเพราะต้องตัดสินเรื่อง Allowlist และการแสดงผลของการแก้
- ไม่มี full-text search Task เก่า (ADR 0036)
- ไม่ตั้งเพดาน Memory ต่อ Agent และไม่เปลี่ยนเพดาน 4,000 ตัวอักษร
- ไม่แคช Memory ลงฐานข้อมูล local และไม่ส่ง Memory ไปกับ `agent.listed`
- Hub ไม่เปลี่ยน; ส่งต่อ envelope ตามปกติ
- ไม่แตะ `veeloe memory` ที่มีอยู่; คำสั่งยังเป็นทางตรวจบน Machine

## Impact

- **Protocol (TS + Rust):** ไฟล์ใหม่ `packages/protocol-ts/src/messages/memory.ts` (`MemoryGetBodySchema`, `MemoryGotBodySchema`), ทะเบียนใน `messages/index.ts`, `packages/protocol/src/messages.rs` (`memory.get`, `memory.got`), fixture ใน `packages/protocol/vectors/messages.json`
- **Runtime core:** `runtime-core/src/memory.rs` เพิ่มตัวอ่านที่คืนทั้งข้อความและจำนวนตัวอักษรในครั้งเดียว; `memory_prompt` ยังเป็นทางเดิมของ prompt
- **Runtime supervisor:** `tasks.rs` รับ `memory.get` และตอบ `memory.got`; `memory.rs` (คำสั่ง CLI) ใช้ตัวอ่านเดียวกัน
- **Controller:** `features/machine-link/model/links.ts` (คำขอ สถานะ ตัวรับคำตอบ), หน้าใหม่ `pages/agent-memory/`, route `app/agents/[agent]/memory.tsx`, แถวทางเข้าใน `pages/agents/ui/AgentPage.tsx`, i18n th/en
- **Docs:** `docs/roadmap.md` เพิ่มบรรทัดใต้ v0.1 (ADR 0048 นับ Memory อยู่ใน v0.1 แล้ว จึงไม่ต้องแก้ ADR)

## Acceptance anchor cases

- เปิดหน้า Memory ของ Agent ที่มีไฟล์ → เห็นเนื้อหาตรงกับไฟล์ จำนวนตัวอักษรตรง และเวลาที่ได้ล่าสุด
- ไฟล์ยาวเกิน 4,000 ตัวอักษร → เห็น 4,000 ตัวแรกพร้อมข้อความให้ย่อ และ UI บอกว่าเนื้อหาถูกตัด
- Agent ที่ยังไม่มี `MEMORY.md` → หน้าแสดงสถานะว่าง ไม่ใช่ error และไม่มีไฟล์หรือโฟลเดอร์ถูกสร้าง
- Machine ออฟไลน์หรือยังไม่ตอบ → แสดง note และไม่เอาเนื้อหาของ Agent อื่นหรือคำตอบเก่ามาแสดงปน
- เนื้อหาที่มี `<script>` หรือ Markdown → แสดงเป็นข้อความ ไม่ถูกตีความหรือรัน
- เปิดหน้าแล้วกดโหลดใหม่หลังแก้ไฟล์บน Machine → เห็นเนื้อหาใหม่ และคำตอบเก่าที่มาช้าไม่ทับคำตอบใหม่
- `veeloe memory <agent>` กับหน้าในแอปแสดงข้อความชุดเดียวกัน
