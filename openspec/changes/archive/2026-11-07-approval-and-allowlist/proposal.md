# Proposal: Approval และ Allowlist

## Why

วันนี้ Agent รันคำสั่ง bash ได้ทุกคำสั่งภายใต้ sandbox โดยไม่เคยถามใคร (ADR 0008) เจ้าของจึงไม่มีจุดใดเลยที่ได้เห็นว่าลูกน้องจะทำอะไรก่อนมันทำ และไม่มีที่ให้ตั้งว่า "คำสั่งพวกนี้อ่านอย่างเดียว รันได้เลย" กับคำสั่งที่ต้องขออนุมัติ ADR 0030 ตัดสินเรื่องนี้ไว้แล้ว — Allowlist เป็นคำนำหน้าของคำสั่งของ bash, ทุกอย่างที่ไม่อยู่ในรายการต้องขอ Approval จาก Member ที่มี Approve ที่ Agent ตัวนั้น — แต่ยังไม่มีซอง ไม่มี event และไม่มีหน้าจอสักชิ้น งานนี้ทำให้ข้อตกลงนั้นเกิดขึ้นจริงทั้งเส้น ตั้งแต่ LLM ขอคำสั่งจนผลกลับไปถึง LLM

## What Changes

- Allowlist ต่อ Agent เก็บที่ Machine และส่งไปกับรายการ Agent: ชุดคำสั่งที่รันได้เลยไม่ต้องขอ Approval
- กฎตัดสินว่าคำสั่งหนึ่งอยู่ใน Allowlist ไหม — เทียบคำนำหน้าทีละคำ, คำสั่งที่ต่อกันด้วย `&&`, `;` หรือ `|` ต้องผ่านทุกท่อน, และ `$(...)`, backtick, `eval` ต้องขอ Approval ทุกครั้ง
- Agent สร้างใหม่เริ่มจาก Allowlist ว่าง แต่แอปเสนอชุดอ่านอย่างเดียวให้ติ๊กก่อนเซ็น (`ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `git status`, `git diff`, `git log`) และ Member ตัดออกได้
- ข้อความโปรโตคอลใหม่ `approval.answer` (Controller → Machine) ที่ Member ใช้ตอบ Approval หนึ่งรายการ
- เมื่อคำสั่งไม่อยู่ใน Allowlist, worker เขียน event `approval.requested` ลง log ของ Task แล้วหยุดรอ Turn นั้นไว้จนมีคำตอบ, ครบเวลาหรือไม่มีคนตอบแล้วได้ผลเป็น error กลับไปที่ LLM และ Turn เดินต่อ
- event `approval.answered` บันทึกว่าใครตอบและตอบว่าอะไร อีกทั้ง event สองตัวนี้อยู่ใน log แบบต่อท้ายอย่างเดียวเหมือน event อื่น
- Controller: การ์ด Approval ในหน้า Task (อนุมัติ, ปฏิเสธ, บอกให้ทำอย่างอื่น, อนุญาตตลอดพร้อมแก้คำนำหน้า), หน้าตั้งค่า Allowlist ของ Agent และช่องติ๊กชุดคำสั่งอ่านอย่างเดียวในหน้าสร้าง Agent
- `agent.create` กับ `agent.update` รับ `allowlist` และ `agent.listed` ส่งกลับมา

ไม่แตะ: tool ที่ทำกับไฟล์ (`read`, `write`, `edit`, `glob`, `grep`) ไม่ผ่าน Allowlist เพราะ sandbox คุมอยู่แล้ว (ADR 0008, 0030) และ Allowlist ยังไม่ใช่กำแพงความปลอดภัย — กำแพงคือ sandbox กับ Egress

## Capabilities

### New Capabilities

- `allowlist`: รูปแบบของรายการ, กฎการแยกท่อนและการเทียบคำนำหน้า, ชุดเริ่มต้นอ่านอย่างเดียว, สิทธิ์และเส้นทางที่รายการถูกแก้, และหน้า Allowlist ในแอป
- `approvals`: Approval หนึ่งรายการตั้งแต่ Agent ขอจน LLM ได้ผล — ใครตอบได้, หมดอายุเมื่อไหร่, เกิดอะไรกับ Turn, และแอปแสดงกับตอบอย่างไร

### Modified Capabilities

- `bash-tool`: ประโยคที่ว่าคำสั่งรันโดยไม่ขอ Approval ถูกยกเลิก — คำสั่งที่ไม่อยู่ใน Allowlist ต้องขอ Approval ก่อน และผลตอนไม่ได้อนุมัติคือ error ที่ LLM อ่านแล้วเดินต่อได้
- `runtime-agents`: `agent.create` รับ Allowlist เริ่มต้น และ `agent.listed` ส่ง Allowlist ของแต่ละ Agent กลับไป
- `agent-settings`: `agent.update` รับ `allowlist` ทั้งชุด และการเปลี่ยนมีผลกับคำขอถัดไปของ worker
- `task-log`: event kind ใหม่สองตัวของ Approval พร้อมสิ่งที่ `body` เก็บ
- `controller-tasks`: หน้า Task แสดงการ์ด Approval และตอบได้ตามสิทธิ์

## Impact

- `packages/protocol`: schema ของ `agent.create`, `agent.update`, `agent.listed`, ซองใหม่ `approval.answer` และ schema ของ body ของ event ใหม่
- `packages/runtime`: supervisor เก็บ Allowlist ในไฟล์รายชื่อ Agent, ส่งถึง worker, และส่งคำตอบ Approval ไปยัง worker ตัวที่รอ; worker เพิ่ม guard ของ bash, เขียน event คู่ของ Approval และถือเวลาหมดอายุของคำขอ
- `controller`: หน้า Task (การ์ด Approval), หน้าสร้าง Agent (ติ๊กชุดอ่านอย่างเดียว), หน้าใหม่ของ Allowlist, ข้อความ TH/EN ของทั้งสามที่
- test: กฎการแยกท่อนกำลังเป็นโค้ดด้านความปลอดภัย (ADR 0030) ต้องมี unit test ครบทุกแบบ, flow test ของ worker ที่ขอ–รอ–ได้คำตอบ และ e2e ที่ตอบ Approval จาก Controller ไปถึงคำสั่งที่รันจริง
