## Why

หลัง `agent-and-task` Owner คุยกับ Agent จากมือถือได้แล้ว แต่ Inbox, หน้า Agent และหน้า Task ยังใช้วงกลมกับไอคอนแทน Character และสถานะบอกได้แค่ทำงานหรือเสร็จ Turn ที่ล้มเหลวก็ขึ้นว่าเสร็จ ส่วนช่องพิมพ์ยังให้ส่งระหว่าง Turn แล้วค่อยบอกว่า Agent ไม่ว่าง change นี้ทำให้หน้าทั้งสามเป็นแบบเดียวกับ `controller-prototype` บนข้อมูลที่มีอยู่จริงแล้ว คือ Agent, Task, event ของ Task และสถานะของ Machine (ADR 0018, 0021)

## What Changes

- เพิ่ม Character เป็นหัวหุ่นยนต์ลอย 2.5D แบบ SVG ตาม prototype พร้อม Mood ห้าแบบที่ได้จาก event ล่าสุดของ Task และสถานะของ Machine คือ ว่าง คิด ทำงาน เสร็จ และออฟไลน์ (ADR 0018, 0022)
- หน้าตาของ Character ถูกเก็บไว้กับ Agent ไม่ได้คิดจากรหัส: หน้าสร้าง Agent สุ่มหน้าตา (ปุ่มสุ่ม Character ใหม่สุ่มหน้าตา ไม่ใช่รหัส) แล้วส่งเป็น field `character` ใน `agent.create` supervisor เก็บไว้กับ Agent ใน `agents.json` และส่งกลับใน `agent.listed` แล้ว Controller เก็บสำเนาในตาราง `agent` หน้าตาจึงไม่เปลี่ยนเองเมื่อสูตรหรือรายการชิ้นส่วนเปลี่ยนในแอปรุ่นหลัง และเหมือนกันทุกเครื่องแม้แอปคนละรุ่น Agent ที่สร้างก่อน change นี้ไม่มี `character` จึงได้หน้าตาเริ่มต้นแบบเดียว
- Character แทน `AgentAvatar` ใน Inbox, รายชื่อ Agent, หน้า Agent, หน้าสร้าง Agent และหัวของ log ในหน้า Task แล้วลบ `AgentAvatar`
- สถานะของ Task เพิ่ม "Turn ล้มเหลว" เมื่อ Turn ล่าสุดจบด้วย error
- ช่องพิมพ์ในหน้า Task ไม่ให้ส่งระหว่าง Turn และบอกว่าส่งได้เมื่อ Turn นี้จบ แทนการส่งไปแล้วได้ `agent.busy` กลับมา
- หน้า Task มีเส้นจางเหนือช่องพิมพ์ และชื่อ Machine กับเวลาที่เริ่มใต้ Character
- จอกว้างตั้งแต่ 960 จุด (iPad และเว็บบนคอม) วาง Inbox เป็นการ์ดด้านซ้ายข้าง Task แบบ Mail
- ยังไม่รวม: Mood รอ (Approval), ตัวแก้ Character, ข้อความที่ LLM กำลังพิมพ์ทีละส่วน และรายการคำสั่งที่ Agent รัน ดูเหตุผลและ change เจ้าของใน `design.md`

## Capabilities

### New Capabilities
- `controller-character`: Character ของ Agent ได้หน้าตาจากไหน และ Mood ได้จาก event และสถานะของ Machine อย่างไร

### Modified Capabilities
- `runtime-agents`: `agent.create` มี field `character` ที่ไม่บังคับ ตรวจที่ขอบของ Protocol แล้ว supervisor เก็บไว้กับ Agent และส่งกลับใน `agent.listed` capability นี้สร้างใน `agent-and-task` ที่ยังไม่ archive จึงเขียนเป็น ADDED เหมือน `controller-tasks`
- `controller-tasks`: เพิ่ม requirement เรื่องสถานะ Turn ล้มเหลว, ช่องพิมพ์ระหว่าง Turn และ Inbox ข้าง Task บนจอกว้าง capability นี้สร้างใน `agent-and-task` ซึ่งยังไม่ archive จึงเขียนเป็น ADDED และต้อง archive `agent-and-task` ก่อน change นี้

## Impact

- **โค้ดใหม่:** `controller/src/entities/character/` (look, mood, `Character`) และ `controller/src/widgets/agent-inbox/`
- **โค้ดที่แก้:** `pages/home`, `pages/task`, `pages/agents`, `entities/task` (สถานะ `failed` และ event ล่าสุดใน summary), `shared/ui/theme.ts` (`useSplit`, `SIDEBAR_WIDTH`), `app/layouts/RootLayout.tsx`, `entities/agent` (column `character`) และ `features/machine-link` ให้ `createAgent` รับ `character` ที่หน้าสุ่มไว้
- **ลบ:** `shared/ui/agent-avatar.tsx`
- **Dependency ใหม่:** `react-native-svg` ใน Controller รุ่นเดียวกับ prototype (15.16.0) ซึ่งมีใน Expo Go อยู่แล้ว
- **Protocol:** `CharacterSchema` ใน `packages/protocol/src/messages/agent.ts` เป็น field ที่ไม่บังคับของ `agent.create` และของ Agent ใน `agent.listed` พร้อม vector ใหม่ใน `vectors/messages.json` เป็นการเพิ่มอย่างเดียวตาม ADR 0023
- **Runtime:** `supervisor/agents` เก็บ `character` ลง `agents.json` ไปกับ Agent
- **ฐานข้อมูลของ Controller:** migration ใหม่เพิ่ม column `character` ในตาราง `agent`
- **Hub:** ไม่แตะ เพราะซองที่เซ็นแล้วผ่าน Hub โดยไม่ถูกอ่าน
- **change ถัดไป:** `sandboxed-commands` แสดงรายการคำสั่งในหน้า Task และ `approval-and-allowlist` เพิ่ม Mood รอพร้อมมือสีส้ม
