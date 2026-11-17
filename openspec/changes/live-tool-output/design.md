## Context

ดู proposal.md (Why)

- **`bash.rs`:** อ่าน stdout ของคำสั่งเป็น chunk ใน loop แล้วเก็บท้ายไว้ใน buffer ที่ตัดต้นทิ้ง (`add`, `trim`) จนคำสั่งจบ จึงส่งผลเดียวกลับเป็น `tool.result` เวลาจำกัดของคำสั่งคือ 120 วินาทีเป็นค่าเริ่มต้นและไม่เกิน 600 วินาที
- **IPC:** worker ส่ง `FromWorker::Event` ให้ supervisor และ supervisor เป็นผู้เดียวที่เขียน Task log (ADR 0018)
- **ข้อความที่ไม่อยู่ใน log:** มีอยู่แล้ว เช่น `machine.status`
- **push:** `push-notifications` (ยังไม่ archive) เพิ่ม Expo Push client และ trigger ใน supervisor ไว้แล้ว

## Goals / Non-Goals

**Goals:**

- Owner เห็นได้ภายในหนึ่งวินาทีว่าคำสั่งที่รันนานยังพิมพ์ output อยู่
- Owner รู้ว่า Turn ค้าง แม้ไม่ได้เปิดแอป

**Non-Goals:**

- เก็บ output สดใน log หรือในฐานข้อมูลของ Controller: ผลเต็มยังอยู่ใน `tool.result`
- output สดของ tool อื่นนอกจาก `bash`: tool อื่นจบเร็วและไม่มี output ระหว่างทาง
- ปลดค้างอัตโนมัติ (หยุด Turn หรือ retry): Owner ตัดสินเองด้วยปุ่มหยุด
- diff ต่อ Turn จาก Runtime

## Decisions

### 1. `tool.output` เป็นข้อความสด ไม่ใช่ event ใน Task log

```
worker --(chunk)--> supervisor --(tool.output, <= 1/s)--> Hub --> Controller (memory only)
                         |
                         +--(tool.result เมื่อจบ)--> Task log --> Controller DB
```

- **รูปของข้อความ:** `tool.output { task, tool_use_id, tail, bytes, elapsed_ms }`
  - `tail` คือท้ายของ output ไม่เกิน 2 KB
  - `bytes` คือจำนวน byte ที่ออกมาทั้งหมดถึงตอนนั้น
- **อัตรา:** supervisor เก็บ chunk ล่าสุดของแต่ละคำสั่ง และส่งเมื่อครบหนึ่งวินาทีนับจากครั้งก่อน คำสั่งที่ไม่มี output ใหม่จะไม่มีข้อความ
- **ผู้รับ:** ส่งถึง Controller ของ Member ที่เริ่ม Task เหมือน event ของ Task (ADR 0034, 0060)
- **ฝั่ง Controller:** เก็บไว้ในหน่วยความจำตาม `tool_use_id` และลบเมื่อ `tool.result` ของ call นั้นมาถึง

- **ทางที่ไม่เลือก: เขียน chunk เป็น event ใน log** log เป็นแบบต่อท้ายอย่างเดียวและไม่ลบ คำสั่ง 10 นาทีที่พิมพ์ทุกวินาทีจะเพิ่ม 600 event ที่ซ้ำกับ `tool.result` และทุก Controller ต้อง sync ทั้งหมด
- **ทางที่ไม่เลือก: ส่งทุก chunk** build ที่พิมพ์เร็วจะส่งหลายร้อยซองต่อวินาทีผ่าน Hub

### 2. Turn ค้างคือเงียบเกินห้านาที ตัดสินที่ supervisor

supervisor มีนาฬิกาต่อ Turn ที่เปิดอยู่ ซึ่งเริ่มนับใหม่เมื่อมี event ใดของ Turn หรือมี chunk ของ output เมื่อเงียบครบ `STALL_AFTER = 5 นาที`:

- supervisor เขียน `turn.stalled { since }` หนึ่งครั้ง
- ไม่เขียนซ้ำจนกว่าจะมีกิจกรรมแล้วเงียบใหม่อีกรอบ
- event ถัดไปของ Turn (`llm.message`, `tool.result`, `turn.ended` และอื่นๆ) ทำให้ Mood ไม่ใช่ค้างอีกเอง ไม่มี `turn.resumed`

ทำไมห้านาที:

- คำสั่งที่เงียบนานแต่ยังทำงาน (เช่น `sleep` หรือ build ที่ไม่พิมพ์อะไร) จะถูกนับว่าค้าง ซึ่งยอมรับได้ เพราะ Owner เห็นเวลาที่รันไปและตัดสินเองได้
- Approval ที่รอคนตอบไม่ใช่ค้าง นาฬิกาจึงหยุดระหว่างที่ `approval.requested` ยังไม่มีคำตอบ
- เป็นค่าคงที่ตัวเดียวใน supervisor ปรับได้ใน change ถัดไปถ้าข้อมูลจริงบอกว่าสั้นหรือยาวไป

- **ทางที่ไม่เลือก: Controller คำนวณจากเวลา event ล่าสุด** ไม่เห็น output ของคำสั่ง จึงนับ build ที่ยังพิมพ์อยู่ว่าค้าง และแจ้งเตือนตอนแอปปิดไม่ได้ (ตัดสินแล้วตอน explore)
- **ทางที่ไม่เลือก: ส่งเป็นข้อความสดแบบ `tool.output`** Controller ที่ออฟไลน์อยู่ตอนนั้นจะไม่รู้ว่าเคยค้าง และ push กับหน้าจอจะไม่ตรงกัน

### 3. push หนึ่งครั้งต่อการค้าง ใช้ข้อความกลางๆ

ใช้ Expo Push client ของ `push-notifications` ส่งถึง Member ที่เริ่ม Turn เท่านั้น ข้อความเป็นข้อความกลางๆ ตามภาษาที่ลงทะเบียนไว้ ไม่มีชื่อ Agent คำสั่ง หรือเนื้อหา Task ตาม non-goal ของ `push-notifications` ก่อนมี E2E และ `data` มีแค่รหัสที่ใช้เปิด Task

### 4. Mood ค้างอยู่หลังออฟไลน์และรอ แต่มาก่อนคิดและทำงาน

`moodOf()` คืน `stuck` เมื่อ event ล่าสุดที่รู้จักคือ `turn.stalled` Machine ออฟไลน์ยังมาก่อน เพราะ Machine ที่หลุดส่ง `turn.stalled` ไม่ได้อยู่แล้ว ถ้า Hub บอกว่าออฟไลน์ Owner ควรเห็นออฟไลน์ ไม่ใช่ค้าง

## Risks / Trade-offs

- **[supervisor ค้างเองหรือ Machine หลุด]** ไม่มีใครเขียน `turn.stalled` → Controller แสดงออฟไลน์ตามสถานะของ Hub ซึ่งตรงกับความจริงกว่าค้าง
- **[output มีข้อมูลลับ]** เช่น token ที่คำสั่งพิมพ์ออกมา → เป็นข้อมูลชุดเดียวกับ `tool.result` ที่ส่งถึงคนเดียวกันอยู่แล้ว และไม่ถูกเก็บเพิ่ม
- **[ซองเพิ่มบน Hub]** → สูงสุดหนึ่งซองต่อวินาทีต่อคำสั่งที่กำลังรัน และเฉพาะเมื่อมี output ใหม่ ถ้า Hub จำกัดอัตราต่อ Machine ในอนาคต `tool.output` เป็นข้อความที่ทิ้งได้
- **[Controller รุ่นเก่าเจอ `turn.stalled`]** → ข้ามไปตาม ADR 0023 (event ชนิดที่ไม่รู้จัก) และ Mood คิดจาก event ก่อนหน้า
- **[push ซ้ำเมื่อค้างหลายรอบใน Turn เดียว]** → หนึ่ง push ต่อ `turn.stalled` และ `turn.stalled` ใหม่เกิดได้หลังมีกิจกรรมแล้วเงียบครบห้านาทีอีกรอบเท่านั้น

## Migration Plan

ส่วน Runtime และ Protocol ออกก่อนได้ เพราะ Controller เก่าข้ามข้อความที่ไม่รู้จัก ส่วน Controller ออกเมื่อ `task-thread-redesign` และ `character-look` เสร็จ ถ้าต้องถอย ให้ปิดการส่ง `tool.output` และการเขียน `turn.stalled` ใน supervisor โดย event ที่เขียนไปแล้วอยู่ใน log ได้โดยไม่มีผลกับ Turn ใหม่
