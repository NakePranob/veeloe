## Why

Change นี้ทำตาม issue #23 (Agents show a Character with a Mood) ในส่วนของ Controller ตั้งแต่ commit `31b8c71` Controller วาด Agent แต่ละตัวเป็นหัวหุ่นยนต์ลอยแบบ 2.5D ที่แสดง Mood จาก event ของ Task แล้ว แต่หน้าตาของแต่ละตัวยังตั้งไว้ตายตัวในข้อมูลของ Demo Workspace Member ยังเปลี่ยนไม่ได้ ซึ่ง #23 ต้องการ ("เลือก Character ตอนสร้าง Agent และเปลี่ยนทีหลังได้") ตอนนี้ Hub ยังไม่มี Agent เลย เพราะการสร้าง Agent อยู่ใน #11 change นี้จึงทำหน้าแก้ Character บน Demo Workspace ก่อน และจัดข้อมูลให้ส่วนที่ Hub เก็บต่อเติมเข้ามาได้ทีหลังโดยไม่ต้องรื้อหน้าจอ

ส่วนที่แตะ: **Controller** อย่างเดียว (ไม่แตะ Protocol, Runtime และ Hub)

ADR ที่ใช้: 0006 (Hub เก็บ Character เพราะไม่ใช่เนื้อหาของ Task และไม่มีผลกับสิทธิ์), 0010 (คนที่แก้ค่าของ Agent ได้คือคนที่มี Grant ระดับ Manage), 0021 (หน้าจออ่านข้อมูลจาก store บนเครื่อง และ hook ใช้ชื่อเดิมเมื่อย้ายไป SQLite), 0022 (Controller วางตาม Feature-Sliced Design และตรวจด้วย Steiger), 0023 (Protocol เพิ่มได้อย่างเดียว ฝั่งรับจึงต้องรับค่าที่ไม่รู้จักได้), 0024 (Demo Workspace ไม่ส่งอะไรออกจากเครื่อง)

## What Changes

- **รูปของข้อมูล:** หน้าตาของ Agent รวมเป็นก้อนเดียว `character: { color, shell, top, sides, decal }` ซึ่งเป็นก้อนเดียวกับที่ Hub จะเก็บทีหลัง และ Character ที่ได้ค่าที่ไม่รู้จักจะถอยไปใช้ค่าตั้งต้นแทนที่จะพัง
- **store ของ Agent:** Agent ใน Demo Workspace ย้ายจาก array ค่าคงที่ไปอยู่ใน store บนเครื่อง ที่หน้าจอทุกหน้าอ่านผ่าน `useAgents` และ `useAgent` เดิม พอแก้ Character แล้ว Inbox กับหน้า Task จะวาดใหม่ตาม
- **ทางเข้า:** หัวหุ่นที่หัวหน้า Task กลายเป็นปุ่ม แตะแล้วเปิด route ใหม่ `agents/[agent]/character` เป็น sheet บน iOS และ Android และเป็นหน้าเต็มบนเว็บ
- **หน้าแก้ Character:** หัวใหญ่ด้านบน แถวหัวขนาด Inbox ของทุก Mood และห้าหมวดให้เลือก คือ เปลือก สี ด้านบน ด้านข้าง และลายบนเปลือก แก้เป็น draft มีปุ่มยกเลิกกับเสร็จ และปุ่มสุ่มที่เลี่ยงหน้าตาที่ซ้ำกับ Agent ตัวอื่น
- **design system:** เพิ่มหน้าแก้ Character เป็น widget และอัปเดต Character ใน artifact ไปพร้อมกัน

**ไม่อยู่ใน change นี้:**
- การให้ Hub เก็บ Character และ message ของ Protocol ที่ใช้ตั้งค่า ซึ่งจะมากับ #11 ตอนที่ Agent เริ่มมีใน Hub
- การเลือก Character ในขั้นตอนสร้าง Agent (#11) ซึ่งจะใช้หน้าแก้ตัวเดียวกัน
- การแสดง Character บน Flow (#20)
- โหมดดูอย่างเดียวสำหรับคนที่ไม่มี Grant ระดับ Manage เพราะ v0.1 มีแค่ Owner คนเดียว
- ท่าย่อยสุ่มตอนว่าง กับ Mood ส่งต่องานและติดขัด

## Capabilities

### New Capabilities
- `controller-character`: Character ของ Agent บน Controller ได้แก่ หน้าตาที่มาจาก Agent, Mood ที่คิดจาก event ของ Task และการที่ Member เปลี่ยนหน้าตาได้

### Modified Capabilities
(ไม่มี)

## Impact

- **โค้ด:** `controller/app` (route ใหม่), `src/pages/agent-character`, `src/features/edit-character`, `src/entities/agent` (store และการถอยไปใช้ค่าตั้งต้น) และหัวหน้าของ `src/pages/task`
- **dependency:** ไม่มีตัวใหม่ ใช้ `react-native-svg`, `@expo/ui` และ `expo-haptics` ที่ติดตั้งอยู่แล้ว
- **design system:** artifact ของ Controller ได้ widget ใหม่ และ README ของ Character เปลี่ยนตาม
- **#23 ยังไม่ปิด:** เมื่อ change นี้เสร็จ #23 ยังเหลือเรื่อง Hub เก็บ Character กับการแสดงบน Flow
