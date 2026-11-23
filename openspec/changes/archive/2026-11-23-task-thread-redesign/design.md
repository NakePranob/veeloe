## Context

ดู proposal.md (Why)

`pages/task/model/items.ts` แปลง event เป็น `Item[]` และมี test อยู่แล้ว (`items.test.ts`) แต่ `ToolCall` มีแค่ `{ id, command, state, output }` โดย `commandOf(use)` ย่อ input ของทุก tool ให้เป็นสตริงเดียว

`TaskPage.tsx` เรียก `useAgents`, `useTrashedAgents`, `useTaskRow`, `useMachines`, `useMachineStatus`, `useTaskEvents`, `usePendingMessages` และมี state ห้าตัว พร้อม `send`, `attach`, `stop` อยู่ในฟังก์ชันเดียว ส่วนการ์ดย่อย (`Bubble`, `Problem`, `CompactedCard`, `FileCard`, `BudgetCard`, `InterruptedCard`) อยู่ในไฟล์เดียวกัน

แบบบน canvas อยู่ในแถว "แชต: ทุกเหตุการณ์ที่เกิดได้" (`Chat-*.dc.html`) และ `B3-Talk`, `B3-Task`

## Goals / Non-Goals

**Goals:**

- ทุกเหตุการณ์บนแถวแชตของ canvas มีที่วาดในโค้ด และทุก Item ในโค้ดมีแบบบน canvas
- การตัดสินใจที่มีกฎ (กลุ่ม tool, action ล่าสุด, สรุปไฟล์, สถานะของหน้า) อยู่ในฟังก์ชันล้วนที่มี test

**Non-Goals:**

- output สดของคำสั่งและสถานะค้าง: อยู่ใน `live-tool-output`
- เปลี่ยนการส่ง คิว การหยุด หรือการตอบ Approval
- ย้ายไปเป็น widget (ดูข้อ 4)

## Decisions

### 1. `ToolCall` เก็บชื่อ tool และเป้าหมาย คำกริยามาจาก i18n

```
ToolCall = { id, tool, target, state, output?, error? }
  tool   : "bash" | "read" | "glob" | "grep" | "edit" | "write" | "memory" | "send_file" | string
  target : คำสั่ง / path / pattern / ชื่อไฟล์ ตาม tool
```

คำกริยาอยู่ใน `tools.<tool>` ของ i18n (เช่น "อ่าน {{target}}", "แก้ {{target}}", "ค้นหา {{target}}") tool ที่ไม่รู้จักใช้ `tools.other` ("ใช้ {{tool}}") ตาม ADR 0023 เพื่อให้ Runtime ที่เพิ่ม tool ใหม่ยังแสดงได้

ไม่ต่อประโยคเอง ตาม ADR 0065

### 2. action ล่าสุดของกลุ่มเป็นฟังก์ชันล้วน `summaryOf(calls)`

```
มี call ที่ running     -> call นั้น                    + จำนวนที่เหลือ
มี call ที่ failed      -> call ที่ failed ตัวล่าสุด + บรรทัด error สุดท้าย + จำนวนที่เหลือ
อื่นๆ                  -> call ตัวสุดท้าย                + จำนวนที่เหลือ
```

กลุ่มที่มี call ล้มเหลวแต่ไม่ใช่ตัวที่แสดง มีจุดแดงกำกับจำนวน การกดเปิดกลุ่มแสดงทุก call พร้อม output 20 บรรทัดท้ายเหมือนเดิม กลุ่มหุบเป็นค่าเริ่มต้นทุกครั้ง และสถานะเปิดหรือหุบไม่ถูกเก็บ

- **ทางที่ไม่เลือก: เปิดกลุ่มที่กำลังรันไว้อัตโนมัติ** log จะกระโดดทุกครั้งที่ tool ใหม่เริ่ม ส่วน action ล่าสุดบอกสิ่งที่กำลังทำได้อยู่แล้ว

### 3. สรุปไฟล์ต่อ Turn เป็น Item ใหม่ `{ kind: "changes", files }`

`items()` สร้าง Item นี้ตอนเจอ `turn.ended` จาก path ของ `edit` และ `write` ที่ได้ผลสำเร็จใน Turn นั้น ไม่นับซ้ำ และเรียงตามครั้งแรกที่แตะ Turn ที่ไม่มีไฟล์ไม่สร้าง Item

`bash` ที่แก้ไฟล์ไม่ถูกนับ เพราะรู้ไม่ได้จาก event ข้อความของแถวจึงเขียนว่า "แก้ N ไฟล์" ไม่ใช่ "ไฟล์ทั้งหมดที่เปลี่ยน"

- **ทางที่ไม่เลือก: ให้ Runtime ส่ง diff ต่อ Turn** แม่นกว่า แต่ต้องแก้ Protocol และ Runtime ส่วนข้อมูลที่มีอยู่ตอบคำถามที่พบบ่อยได้แล้ว

### 4. แยกไฟล์ใน `pages/task` ก่อน ยังไม่ย้ายไปเป็น widget

FSD ใช้ widget สำหรับก้อนที่หลายหน้าใช้ร่วมกัน ตอนนี้มีแค่หน้า Task ที่ใช้ log และ composer (หน้าจอกว้างวาง `agent-inbox` ข้างหน้า Task ไม่ได้ใช้ส่วนของ Task ร่วมกัน) จึงแยกเป็นไฟล์ใน `pages/task/ui/` และย้ายเมื่อมีหน้าที่สองต้องใช้จริง

```
pages/task/
  model/items.ts         Item[] + summaryOf + changes   (มี test)
  model/screen.ts        useTaskScreen(): agent, machine, status, readOnly, busy, isStopping
  ui/TaskPage.tsx        ประกอบชิ้น + Stack.Screen header
  ui/Message.tsx         member bubble, agent text, queued, event line
  ui/ToolGroup.tsx       กลุ่มหุบ/เปิด
  ui/ChangesRow.tsx      สรุปไฟล์
  ui/ApprovalCard.tsx    (มีอยู่) ปรับหน้าตา
  ui/Composer.tsx        ช่องพิมพ์ แนบไฟล์ ส่ง/หยุด
  ui/cards/*.tsx         Budget, Interrupted, Compacted, File, Problem
```

- **ทางที่ไม่เลือก: ย้ายเป็น `widgets/task-thread` ตามที่กระดาน Design system ติดป้ายไว้** เพิ่มชั้นที่ไม่มีคนที่สองใช้ ป้ายบนกระดานจะแก้เป็น "อยู่ใน pages/task"

### 5. Header ใช้ `headerTitle` ของ Stack ไม่สร้าง header เอง

Character ขนาด 36 กับชื่อและสถานะเป็น component ที่ส่งให้ `Stack.Screen options.headerTitle` ปุ่มกลับและตัวแถบยังเป็นของระบบตาม `controller/AGENTS.md` การแตะ Character หรือชื่อเปิดหน้า Agent เหมือนปุ่มตั้งค่า

## Risks / Trade-offs

- **[`headerTitle` บน web วาดต่างจาก iOS]** → ตรวจทั้งสองแพลตฟอร์มตาม AGENTS.md ถ้า web วาดไม่ได้ ให้ web แสดงชื่ออย่างเดียว
- **[สรุปไฟล์ไม่นับไฟล์ที่ bash แก้]** → คำบนแถวบอกขอบเขตตรงๆ และ `live-tool-output` หรือ change ถัดไปค่อยเพิ่ม diff จาก Runtime ถ้าจำเป็น
- **[กลุ่มที่หุบซ่อน error ที่ไม่ใช่ตัวล่าสุด]** → จุดแดงบนจำนวน และกลุ่มที่มี error แสดงตัวที่ล้มเหลวก่อนตัวที่สำเร็จ
- **[แยกไฟล์ใหญ่แล้วพฤติกรรมเพี้ยน]** → ย้าย logic ไป `model/` พร้อม test ก่อนแตะ UI และ `items.test.ts` เดิมต้องผ่านตลอด
