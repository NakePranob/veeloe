## Why

หลัง `machine-pairing` Owner ผูก Machine กับแอปได้แล้ว แต่ Machine ยังทำอะไรไม่ได้ เพราะ supervisor ได้แค่ตรวจซองแล้ว log ไว้ change นี้ทำให้ Owner สร้าง Agent และคุยกับ Agent ใน Task จากมือถือได้จริง โดยวางโครงที่ `sandboxed-commands`, `approval-and-allowlist` และ change หลังจากนั้นต่อยอดได้ คือ worker หนึ่งโปรเซสต่อ Agent, Task แบบ event log และ proxy ที่ถือ key ของ Provider (ADR 0018, 0020, 0042)

## What Changes

- เพิ่ม `veeloe provider add`, `list` และ `remove` ให้ Owner ตั้ง Provider บน Machine ด้วย terminal key อยู่ในไฟล์ของ supervisor และไม่ผ่าน Hub หรือแอปเลย ส่วนการใส่ key ในแอปแบบ sealed box ตาม ADR 0005 และ 0042 แยกเป็น change ของตัวเอง
- เพิ่ม proxy ของ LLM ใน supervisor ที่ใส่ key ก่อนส่งต่อ worker จึงไม่เคยเห็น key
- เพิ่มรายชื่อ Agent ใน supervisor, การสร้าง Workdir ที่ `agents/<id>/workdir` (ADR 0032) และการเปิด `veeloe worker --agent <id>` หนึ่งโปรเซสต่อ Agent ซึ่งคุยกับ supervisor ทาง IPC และถูกเปิดใหม่เมื่อพัง
- เพิ่ม worker แบบ hexagonal ที่ทำ Turn ด้วย harness ของเราเองบน `@anthropic-ai/sdk` (ADR 0004) และเก็บ Task เป็น event log แบบต่อท้ายอย่างเดียวใน `tasks.db`
- เพิ่มข้อความใน Protocol สำหรับสร้างและดูรายชื่อ Agent, ส่งข้อความใน Task, ส่ง event ของ Task และขอ event หลังเลข N พร้อม vector
- เพิ่มใน Controller การเชื่อมต่อกับ Hub ที่เปิดค้างระหว่างแอปปลดล็อก, ตาราง Agent กับ event ของ Task, หน้าสร้าง Agent, หน้า Agent ที่มีรายชื่อ Task และหน้าแชตเรียบๆ
- harness รองรับการเรียก tool ผ่าน port แต่ Agent ยังไม่มี tool จริง tool อ่านเขียนไฟล์อยู่ใน `workdir-file-tools` และ bash อยู่ใน `sandboxed-commands`

## Capabilities

### New Capabilities
- `runtime-providers`: Owner ตั้ง Provider บน Machine อย่างไร และ supervisor ส่งคำขอไป LLM แทน worker อย่างไรโดยไม่ให้ worker เห็น key
- `runtime-agents`: supervisor สร้าง เก็บรายชื่อ และดูแล worker ของ Agent แต่ละตัวอย่างไร
- `task-log`: Task เก็บและส่งเป็น event log อย่างไร Turn เริ่มและจบเมื่อไหร่ และ Controller ตามทันได้อย่างไร
- `controller-tasks`: Owner สร้าง Agent และคุยใน Task จาก Controller อย่างไร

### Modified Capabilities

ไม่มี ข้อความใหม่เป็นแบบ additive ตาม `protocol-envelope` และ Hub ส่งต่อซองด้วยกฎเดิมของ `hub-relay` โดยไม่ต้องแก้

## Impact

- **โค้ดใหม่:** `packages/runtime/src/supervisor/{providers,proxy,agents,task-message,task-sync}`, `packages/runtime/src/worker/{core,adapters}`, `packages/protocol/src/messages/{agent,task}*.ts` และ slice ใหม่ใน `controller/`
- **Dependency ใหม่:** `@anthropic-ai/sdk` ใน Runtime
- **Hub:** ไม่แตะ
- **เครื่องมือ:** dependency-cruiser เพิ่มกฎว่าแกนของ worker ไม่ import adapter และ slice ของ supervisor ไม่ import กัน
- **ยังไม่รวม:** tool จริง, Effort ต่อข้อความ, การส่งข้อความที่ LLM กำลังพิมพ์ทีละส่วน, คิวงานเมื่อ Agent ไม่ว่าง (`one-writer-queue`), การปิด Turn ที่ค้างหลังเริ่มใหม่ (`stop-and-restart`), Budget (`daily-budget`), Memory และการย่อ context, Inbox กับ Character (`controller-task-screens`) และการใส่ key ของ Provider ในแอป
- **change ถัดไป:** `sandboxed-commands` เพิ่ม bash เป็น tool แรกผ่าน port ToolRunner
