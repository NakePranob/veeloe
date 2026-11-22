## Why

ตอนนี้ Owner ไม่มีทางรู้ว่าคำสั่งที่ Agent รันยังเดินอยู่หรือค้างไปแล้ว:

- **ผลมาตอนจบเท่านั้น:** `tool.result` มาถึงตอนคำสั่งจบ ระหว่างที่ build หรือ test รันนานหลายนาที หน้า Task แสดงแค่วงหมุน
- **Provider หรือ worker ค้างแยกไม่ออก:** ถ้า Provider ไม่ตอบหรือ worker ค้าง หน้าตาเหมือน Agent กำลังคิดตามปกติ
- **ไม่มีแจ้งเตือน:** คนที่สั่งงานแล้ววางมือถือไม่ได้รับอะไรเลย

แบบบน canvas (`Chat-Live`) แสดงบรรทัดล่าสุดของ output กับเวลาที่รันไปแล้ว และแผ่น Character มี Mood ค้าง ซึ่ง `character-look` วาดท่าไว้แล้วแต่ยังไม่มีอะไรทำให้เกิด ทั้งสองอย่างต้องมาจาก Runtime เพราะ Runtime เป็นที่เดียวที่เห็นว่าคำสั่งยังพิมพ์ output อยู่หรือไม่ และส่ง push ได้แม้แอปปิดอยู่

## What Changes

- **output สด:** worker ส่ง output ของคำสั่ง `bash` ที่กำลังรันให้ supervisor เป็นช่วงๆ และ supervisor ส่งข้อความใหม่ `tool.output` ถึง Controller ของคนที่เริ่ม Task
  - ข้อความนี้ไม่ใช่ event ใน Task log และไม่ถูกเก็บ
  - ส่งไม่เกินหนึ่งครั้งต่อวินาทีต่อคำสั่ง และส่งเฉพาะท้ายของ output
- **Turn ค้าง:** supervisor เขียน event ใหม่ `turn.stalled` ลงใน Task log เมื่อ Turn ที่ยังเปิดอยู่ไม่มี event ใหม่และไม่มี output ของคำสั่งเกินห้านาที
  - เขียนครั้งเดียวต่อช่วงที่เงียบ
  - event ถัดไปของ Turn ทำให้หายค้างเอง ไม่มี event แยก
- **push:** ตอน `turn.stalled` ส่ง push หนึ่งครั้งถึง Member ที่เริ่ม Turn ผ่านกลไกของ `push-notifications`
- **Controller:**
  - คำสั่งที่กำลังรันแสดงบรรทัดล่าสุดของ output กับเวลาที่รันไปแล้วใน ToolGroup
  - Mood ค้างเมื่อ event ล่าสุดของ Turn ที่เปิดอยู่คือ `turn.stalled`
- **ADR ใหม่:** ข้อความที่ส่งสดแต่ไม่อยู่ใน Task log และเกณฑ์ของ Turn ค้าง
- **ไม่เปลี่ยน:** `tool.result` ยังเป็นผลเต็มของคำสั่งที่ LLM ได้และที่ถูกเก็บ Controller ที่ไม่ได้เปิดอยู่ตอนคำสั่งรันจะเห็นผลเมื่อคำสั่งจบเหมือนเดิม

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `bash-tool`: คำสั่งที่กำลังรันส่ง output เป็นช่วงๆ ให้ Controller ที่เปิดอยู่
- `task-log`:
  - event ใหม่ `turn.stalled` และเกณฑ์ที่ supervisor ใช้เขียน
  - push ถึง Member ที่เริ่ม Turn เมื่อค้าง
- `controller-tasks`: คำสั่งที่กำลังรันแสดง output ล่าสุดและเวลาที่รันไปแล้ว
- `controller-character`: Mood ค้าง

## Impact

- **Protocol:**
  - ข้อความ `tool.output` ใน `packages/protocol-ts/src/messages/task.ts` และ `packages/protocol/src`
  - `TaskEventKind.TurnStalled`
  - vector ใหม่ใน `packages/protocol/vectors` ทั้งสองฝั่งและสำเนาของ Hub (`bun run check:protocol`)
- **Runtime:**
  - `runtime-worker/src/tools/bash.rs` ส่ง chunk
  - `runtime-core/src/ipc.rs` เพิ่มข้อความจาก worker
  - `runtime-supervisor` จำกัดอัตราและส่งต่อ, นาฬิกาค้างต่อ Turn, เขียน `turn.stalled` และส่ง push
- **Hub:** ไม่เปลี่ยนโค้ด แต่จำนวนซองต่อ Task ที่กำลังรันคำสั่งเพิ่มขึ้นสูงสุดหนึ่งซองต่อวินาที
- **Controller:**
  - `features/machine-link` รับ `tool.output` เก็บในหน่วยความจำ
  - `pages/task` แสดงใน ToolGroup
  - `entities/character` คืน Mood `stuck`
- **ขึ้นกับ:**
  - `push-notifications` ต้อง archive ก่อน
  - `task-thread-redesign` (ToolGroup) และ `character-look` (ท่าค้าง) ต้องเสร็จก่อนส่วนของ Controller
  - ส่วนของ Runtime เริ่มได้ทันที
