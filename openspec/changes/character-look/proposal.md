## Why

แผ่น Character บน canvas redesign เปลี่ยนชุดสีของ Agent เพิ่มเปลือกทรงกลม และแยก Mood ใหม่สองแบบ ส่วน Character ในโค้ดยังเป็นชุดเดิม และยังมีจุดที่ไม่ตรงกันอยู่ก่อนแล้วสามจุด:

- spec `controller-character` บอกว่ามี Mood ห้าแบบ แต่ `mood.ts` มีหกแบบ เพราะ "รอ" (ยกมือเมื่อ Approval รออยู่) ถูกเพิ่มโดยไม่ได้แก้ spec
- Turn ที่จบด้วย error แสดงเป็น "ว่าง" เหมือน Agent ที่ไม่มีงาน คนดู Inbox จึงแยกไม่ออกว่า Agent ล้มเหลวหรือแค่ว่าง
- hex ของสีอยู่ในหน้า `pages/agent-character` แทนที่จะอยู่กับ entity

change นี้ทำให้ Character ตรงกับแผ่น Character และเป็นที่เดียวที่ Mood ถูกนิยาม ก่อนที่ `task-log-widgets` และ `screens-redesign` จะใช้

## What Changes

- **ชุดสีที่เลือกได้:** เปลี่ยนเป็น 8 สีใหม่ตามแผ่น Character (เนย ฟ้า มินต์ ไลแลค พีช ส้ม โรส ทราย) ส่วน Agent ที่มีอยู่ยังใช้สีเดิมของตัวเอง และ Agent ที่ไม่มี `character` ยังได้หน้าตาเริ่มต้นเดิม
- **เปลือก:** เพิ่มทรงกลม (`round`) เป็นเปลือกแบบที่ห้า
- **Mood ล้มเหลว:** Turn ที่จบด้วย error แสดง Mood ล้มเหลว แทนการกลับไปเป็นว่าง
- **Mood รอ:** เขียนลงใน spec ให้ตรงกับที่โค้ดทำอยู่แล้ว
- **Mood ค้าง:** วาดท่าไว้ใน Character แต่ยังไม่มีอะไรทำให้ Agent เข้า Mood นี้ ส่วนที่ Runtime บอกว่าค้างอยู่ใน change `live-tool-output`
- **ที่อยู่ของสี:** สีทั้งหมดย้ายจาก `pages/agent-character` ไปอยู่ใน `entities/character` และลบข้อยกเว้นชั่วคราวที่ `controller-theme` ตั้งไว้
- **หน้าแก้ Character:** ตามแผ่นบน canvas:
  - ฉากสีอ่อนตามสีที่เลือก
  - การ์ดท่าทั้งหกแบบที่กดดูได้
  - ปุ่มสุ่มเป็นไอคอนลอยข้างหัว
  - ช่องที่เลือกแสดงด้วยพื้นสีของ Agent ไม่มีกรอบ

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `controller-character`: Mood เพิ่มจากห้าแบบเป็นเจ็ดแบบ (รอ และล้มเหลว) และ Turn ที่จบด้วย error ไม่เป็นว่างอีก ส่วนชุดสีใหม่ต้องไม่เปลี่ยนหน้าตาของ Agent ที่มีอยู่ ซึ่ง requirement เดิมกำหนดไว้แล้ว จึงไม่ต้องแก้ requirement นั้น

## Impact

- **Controller:**
  - `src/entities/character/model/look.ts` และ `mood.ts`
  - `src/entities/character/ui/Character.tsx`
  - `src/pages/agent-character` และ `src/pages/new-agent` (สุ่มสีจากชุดใหม่)
  - `.conventions/rules.json`: ลบข้อยกเว้น hex ของ `pages/agent-character`
- **Runtime และ Protocol:** ไม่เปลี่ยน เพราะ `character` เป็น string ที่ Machine เก็บตามที่ส่งมา
- **Controller รุ่นเก่า:** เห็น `round` เป็นเปลือกแบบแรก (กล่อง) ตามกฎช่องที่ไม่รู้จักที่มีอยู่แล้ว
- **ขึ้นกับ:** `controller-theme` (token สีสถานะและกฎการใช้ element)
