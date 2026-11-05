## Why

หลัง `agent-and-task` Owner คุยกับ Agent ได้แล้ว แต่ Agent ยังทำอะไรบนเครื่องไม่ได้ เพราะ `ToolRunner` มีแค่ `no-tools` change นี้เพิ่ม bash เป็น tool แรก และวางกำแพงที่ ADR 0008 กำหนดไว้ก่อน คือครอบ worker ทั้งโปรเซสด้วย sandbox ของ OS บน macOS และ Linux พร้อม Egress รายชื่อเดียวทั้ง Machine เพื่อให้ `workdir-file-tools` และ `approval-and-allowlist` ต่อยอดบนกำแพงนี้ได้เลย

## What Changes

- supervisor เปิด worker ทุกตัวใน sandbox ด้วย `@anthropic-ai/sandbox-runtime` (Seatbelt บน macOS, bubblewrap บน Linux) worker เขียนได้แค่ในโฟลเดอร์ของ Agent ตัวเอง อ่านโฟลเดอร์ของ Runtime กับไฟล์ลับไม่ได้ และออกเน็ตได้เฉพาะโดเมนใน Egress
- เครื่องที่ทำ sandbox ไม่ได้ (Windows นอก WSL2 หรือ Linux ที่ไม่มี bubblewrap) supervisor ไม่เปิด worker เลย และบอกว่าขาดอะไร
- **BREAKING (ภายใน Runtime)** คำขอไป LLM ของ worker เปลี่ยนจาก HTTP ที่ `127.0.0.1` พร้อมรหัส มาวิ่งผ่านช่อง IPC เดิม เพราะ sandbox ตัด localhost ออก และตรงกับ ADR 0008 กับ 0042 ที่ให้ช่องทางคุยกับ supervisor เป็นทางเดียวที่คำขอไป LLM วิ่งผ่าน รหัสของ worker จึงหายไปจาก environment
- เพิ่ม tool `bash` ผ่าน port `ToolRunner` รันคำสั่งใน Workdir มีเวลาจำกัด ตัดผลที่ยาวเกิน และส่ง exit code ให้ LLM
- เพิ่ม Egress ของ Machine ที่เก็บใน `runtime/egress.json` เริ่มจากว่าง Owner แก้ได้จากหน้า Machine ในแอปด้วยข้อความ `egress.set` ที่เซ็นหลังยืนยันตัวใหม่ แอปบอกให้ชัดว่ารายชื่อนี้ใช้กับ Agent ทุกตัวบนเครื่อง และ `veeloe unpair` ล้างรายชื่อ
- หน้า Task ของ Controller แสดงคำสั่งที่ Agent รันพร้อมผล ตาม `controller-prototype`
- ยังไม่มี Approval คำสั่ง bash รันทันทีภายใต้ sandbox จนกว่า `approval-and-allowlist` จะมา ซึ่งเป็น change ถัดไปบนเส้นทางแรก

## Capabilities

### New Capabilities
- `runtime-sandbox`: worker ของ Agent รันใน sandbox อย่างไร อ่าน เขียน และออกเน็ตได้แค่ไหน และ Runtime ทำอะไรบนเครื่องที่ทำ sandbox ไม่ได้
- `machine-egress`: Egress รายชื่อเดียวของ Machine ใน v0.1 เก็บที่ไหน แก้จาก Controller อย่างไร และใช้กับ Agent ทุกตัวบนเครื่อง (ADR 0008, 0029)
- `bash-tool`: Agent รันคำสั่ง bash อย่างไร และ LLM ได้ผลกลับแบบไหน

### Modified Capabilities
- `runtime-providers`: requirement "worker คุยกับ LLM ผ่าน proxy ของ supervisor เท่านั้น" เปลี่ยนจาก proxy ที่ฟังบนเครื่องพร้อมรหัส เป็นช่อง IPC ของ worker ตัวนั้น (spec นี้มาจาก `agent-and-task` ต้อง archive ก่อน)
- `controller-tasks`: เพิ่มการแสดงคำสั่งที่ Agent รันและผลในหน้า Task (spec นี้มาจาก `agent-and-task` เช่นกัน)

## Impact

- **โค้ดใหม่:** `packages/runtime/src/supervisor/{sandbox,egress}`, `packages/runtime/src/worker/adapters/bash.ts`, `packages/protocol/src/messages/egress.ts` และส่วนใหม่ใน `controller/src/pages/{task,machines}`
- **โค้ดที่แก้:** `supervisor/workers` เปิด worker ผ่าน sandbox, `supervisor/proxy` จาก `Bun.serve` เป็นฟังก์ชันที่ตอบคำขอจาก IPC, `worker/adapters/anthropic-llm.ts` ใช้ `fetch` ที่ส่งทาง IPC, `ipc.ts` เพิ่มข้อความ `llm.request` กับ `llm.response`, `agent.listed` เพิ่ม field `egress` แบบ additive
- **Dependency ใหม่:** `@anthropic-ai/sandbox-runtime` pin เวอร์ชันตรงตัว บน Linux ต้องมี `bubblewrap` กับ `socat` บนเครื่อง
- **Hub:** ไม่แตะ
- **CI:** job e2e บน Linux ติดตั้ง bubblewrap และเปิด user namespace ให้ sandbox ทำงานได้
- **เครื่องมือ:** dependency-cruiser เพิ่ม slice `egress`
- **ยังไม่รวม:** Approval กับ Allowlist (`approval-and-allowlist`), tool read, write, edit, glob และ grep (`workdir-file-tools`), Stop ระหว่างคำสั่งรัน (`stop-and-restart`), Egress ต่อ Agent และโหมดทั้งเน็ต (ADR 0029), shell ที่จำ `cd` ข้ามคำสั่ง, การรัน Runtime ใน Docker และ Windows native
