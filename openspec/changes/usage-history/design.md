# Design

## Context

- `daily-budget` นับ token ที่ `createLlmHandler` ใน `packages/runtime/src/supervisor/proxy/proxy.ts` แล้วเรียก `onUsage(agent, tokens)` ซึ่งต่อกับ `createBudgets` ที่เก็บยอดวันนี้ใน `runtime/usage.json` และใช้ยอดนั้นบังคับ Budget (ADR 0043) handler อ่านหัว `x-veeloe-task` อยู่แล้วเพื่อเลือก Route ของ Task
- Runtime ใช้ `bun:sqlite` อยู่แล้วในฝั่ง worker (ADR 0014) แต่ supervisor ยังใช้ไฟล์ JSON (`agents.json`, `trust.json`, `usage.json`) ไม่มีฐานข้อมูลของตัวเอง
- Controller เป็น local-first (ADR 0021): มี migration แบบ append-only, `useLiveQuery` แบบแจ้งครั้งเดียวต่อชุดที่ commit, และ `machine-link` เป็นที่เดียวที่เปิดซ็อกเก็ตกับ Hub ข้อความที่ส่งไปแต่ละ Machine ถูกเก็บ sig ไว้เพื่อจับคู่คำตอบ (`sentTo`) แต่ยังไม่มีทางจับคู่คำตอบที่ไม่ใช่ error
- หน้าใน Controller เป็น stack ไม่มีแท็บ ทางเข้าของฟีเจอร์ที่ไม่ใช่บทสนทนาคือหน้า Workspace ซึ่งมีแถว "Machine", "Agent", "เครื่องของฉัน" อยู่แล้ว
- `controller-prototype/src/pages/usage/ui/UsagePage.tsx` มีหน้าตาที่ต้องการ (ยอดวันนี้ต่อ Agent, แหล่งที่มา, ต่อ Member) แต่ใช้ข้อมูล Demo และสมมติว่ามีประวัติกับแหล่งที่มาแล้ว
- `react-native-svg` มีอยู่ใน Controller แต่กราฟแท่งง่าย ๆ วาดด้วย `View` ได้โดยไม่ต้องเพิ่ม abstraction ใหม่

## Goals / Non-Goals

**Goals:**
- ที่เก็บเดียวที่ตอบทั้ง "วันนี้ใช้เท่าไหร่" และ "หลายวันใช้เท่าไหร่ กับงานอะไร" โดยไม่มียอดสองที่
- คำขอหนึ่งครั้งได้ข้อมูลที่มีขอบเขตคงที่ ไม่โตตามจำนวนคำตอบ และไม่ต้องพึ่งนาฬิกาของมือถือ
- หน้าเดียวที่ตอบคำถามของ Owner ได้ทั้งระดับเครื่องและระดับ Agent พร้อมใช้ได้ตอนออฟไลน์เท่าที่มีแคช

**Non-Goals:**
- ราคาเป็นเงิน, ยอดต่อ Member, แหล่งที่มาที่ไม่ใช่ Task, เพดานระดับ Machine, การตั้ง Budget จากหน้านี้
- การเก็บประวัตินานกว่า 30 วัน หรือการส่งออก
- กราฟแบบเส้น/ซูม/เทียบช่วงก่อน — แท่งต่อวันพอสำหรับการตัดสินใจเรื่อง Budget

## Decisions

### ที่เก็บเดียว: `usage.db` ในโฟลเดอร์ของ supervisor

สร้าง `packages/runtime/src/supervisor/usage/store.ts` เปิด `bun:sqlite` ที่ `supervisorDir(home)/usage.db` แล้ว `chmod 0600` หลังสร้าง เพราะ SQLite สร้างไฟล์ตาม umask

```sql
CREATE TABLE usage (
  agent  TEXT NOT NULL,
  day    TEXT NOT NULL,
  source TEXT NOT NULL,
  task   TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL,
  PRIMARY KEY (agent, day, source, task)
);
CREATE INDEX usage_by_day ON usage (day);
```

- `add(agent, day, source, task, tokens)` ใช้ `INSERT ... ON CONFLICT DO UPDATE SET tokens = tokens + excluded.tokens` — หนึ่งคำตอบหนึ่งแถว ไม่ต้องคำนวณยอดเดิมในหน่วยความจำ
- `total(agent, day)` คือ `SUM(tokens)` ของวันนั้น ใช้ทั้งบังคับ Budget และ `listedOf`
- `range({ agents, from, to })` คืนผลรวมรายวัน, Task ที่มากที่สุด 20 อัน และผลรวมตามแหล่งที่มา โดยกรอง `agents` ใน SQL
- `prune(before)` ลบแถวที่ `day < before` เรียกตอนเปิดและเมื่อ `budgetDay` เปลี่ยน (เทียบกับวันที่จำไว้ตอนเปิด)
- `importLegacy(file)` เมื่อตารางว่างและมี `usage.json`: อ่านยอดของวันนี้แล้วเพิ่มเป็นแถว `source='task', task=''` ในธุรกรรมเดียว แล้วเปลี่ยนชื่อไฟล์เป็น `usage.json.migrated` เพื่อไม่ให้อ่านซ้ำ ถ้า import ไม่ผ่าน supervisor ไม่เริ่ม เพื่อไม่ให้ยอดหายเงียบ ๆ

`createBudgets` เปลี่ยนไปใช้ store: `usageOf` = `store.total`, `add` = `store.add(..., 'task', task, tokens)`, `limitOf`/`exhausted`/`listedOf` คงเดิม signature `add` จึงรับ `task` เพิ่ม

ทางเลือกที่ตัดออก: เก็บ `usage.json` ต่อ (มียอดสองที่และต้องเขียนสองครั้ง), JSONL ต่อวัน (ตอบช่วงต้องอ่านทุกไฟล์), SQLite แยกไฟล์ต่อ Agent ตาม ADR 0014 (ยอดรวมข้าม Agent ต้องเปิดหลายไฟล์ และ supervisor ไม่ได้รัน worker แยกกัน)

### แหล่งที่มาและ Task ใน v0.1

`createLlmHandler` ส่ง `onUsage(agent, task, tokens)` โดย `task` คือค่าหัว `x-veeloe-task` หรือ `undefined` แล้ว `index.ts` แปลงเป็น `''` ให้ store แหล่งที่มาคงที่เป็น `task` เพราะยังไม่มี Schedule, Idle Work, Watch หรือ Channel (ADR 0048) การนำเข้าจาก `usage.json` ก็ใช้ `task=''` เพราะไม่รู้ว่าเป็น Task ไหน

ทางเลือกที่ตัดออก: ให้ worker เป็นคนรายงานยอด (worker ไม่เห็น `usage` ของ Provider ทั้งก้อนในที่เดียว), ให้ proxy ส่งยอดต่อ Task ไปกับ event ของ Task (ทำให้ event log โตและปนเรื่องเงินเข้าบทสนทนา)

### Protocol: `usage.list` กับ `usage.listed`

คำขอ (Controller → Machine, เซ็นแล้ว):

```ts
{ request: string, days: number, agent?: string }
```

Machine คำนวณ `from = budgetDay(now) - (days - 1)` และ `to = budgetDay(now)` จากนาฬิกาของตัวเอง แล้วตอบ:

```ts
{
  request: string,
  from: string,
  to: string,
  agents: [{
    agent: string,
    days: { day: string, tokens: number }[],          // เฉพาะวันที่มีแถว
    tasks: { task: string, tokens: number }[],        // 20 อันที่มากที่สุด, ไม่มี task = ''
    sources: { source: string, tokens: number }[]
  }]
}
```

- `request` เป็นสตริงที่ผู้ขอสร้าง (Controller ใช้ `randomUUID`) และสะท้อนกลับเพื่อทิ้งคำตอบที่มาช้า
- `days` เป็นจำนวนเต็ม 1 ถึง 90; นอกช่วงนั้นตอบ `usage.invalid_range`
- `agent` ที่ระบุต้องมีและผู้ขอมี Manage ไม่งั้น `agent.unknown`; ไม่ระบุ = ทุก Agent ที่ผู้ขอมี Manage
- `days` ไม่เติมวันว่างเป็นศูนย์ — แอปแยก "ไม่มีข้อมูล" กับ "ใช้ 0" ได้
- `tasks` ตัด `task=''` ออก; ยอดที่เหลือยังอยู่ในผลรวมรายวัน แอปจึงแสดง "อื่น ๆ" จากผลต่างได้
- คำตอบส่งถึงผู้ขอคนเดียว และไม่มีเนื้อหา ชื่อไฟล์ หรือข้อมูลของ Provider

ทางเลือกที่ตัดออก: ใส่ `usage` 30 วันใน `agent.listed` (ทุกการต่อต้องแบกข้อมูลโต), ส่งจาก/to จาก Controller (นาฬิกามือถือคนละเขตเวลากับ Machine ทำให้วันเพี้ยน), ให้ Machine คำนวณรายงานสำเร็จรูป (เปลี่ยนหน้าจอต้องแก้ Runtime)

### Controller: แคชยอดรายวันและจับคู่คำตอบ

- migration ใหม่: `CREATE TABLE usage_day (agent_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL, PRIMARY KEY (agent_id, day))` และ `ALTER TABLE machine ADD COLUMN usage_fetched_at INTEGER`
- `saveUsageHistory(database, machineId, agents)` เขียนยอดรายวันของช่วงที่ได้แบบ upsert (คำตอบจาก Machine เป็นความจริงของช่วงนั้น) และลบแถวที่เก่ากว่า 30 วันของ Agent บนเครื่องนั้น
- `saveUsageFetchedAt` เก็บเวลาที่ได้คำตอบล่าสุดต่อ Machine ไว้แสดง "ข้อมูลเมื่อ"
- `machine-link` เพิ่ม `requestUsage(machine, days, agent?)` ที่ส่ง `usage.list` พร้อม `request` ที่สร้างจาก `newId` และเก็บ map `request → { machine, listener }`; เมื่อได้ `usage.listed` จะเขียนแคชก่อน แล้วแจ้ง listener ตาม `request` (ถ้าหน้ายังเปิดอยู่) คำตอบที่ไม่รู้จัก `request` ถูกทิ้ง
- หน้า usage อ่านจาก `usage_day` ด้วย `useLiveQuery` (join `agent` เพื่อจัดกลุ่มตาม Machine) จึงเห็นยอดที่เพิ่งเขียนทันที และตอนออฟไลน์ก็ยังเห็นแคชพร้อมเวลาที่ได้ล่าสุด
- ช่วงวันที่ของแต่ละ Machine มาจาก `from`/`to` ในคำตอบ ไม่ใช่วันของมือถือ; หน้าแสดงวันที่ตามที่ได้มา

ทางเลือกที่ตัดออก: ให้หน้าเก็บผลลัพธ์ในหน่วยความจำอย่างเดียว (ปิดแอปแล้วหาย ไม่ตรงกับ local-first), ให้ `machine-link` รวมยอดข้าม Agent (หน้าเป็นคนจัดกลุ่มตาม Machine/Agent อยู่แล้ว), ใช้ `sentTo` ของ sig จับคู่ (ไม่ได้ผูกกับคำขอที่ผู้ใช้สร้างและทิ้งยาก)

### หน้า "การใช้ token"

- route `controller/app/usage.tsx` เปิดจากแถวใหม่ในหน้า Workspace (`Row icon="usage" title={t("usage")} href="/usage"`) ต้องเพิ่มไอคอน `usage` (`chart.bar` / `bar_chart`) ใน `shared/ui/icon.tsx`
- ตัวเลือกช่วง 1, 3, 7, 30 วัน เป็น pill/segmented ตาม design system ค่าเริ่มต้น 7 เก็บใน `device_setting` key `usage.window`
- เมื่อเปิดหรือเปลี่ยนช่วง: ขอ `usage.list` จากทุก Machine ที่มี Agent; ระหว่างรอและตอนออฟไลน์แสดงแคชพร้อม "ข้อมูลเมื่อ …"
- โครงหน้า: สรุปช่วง (ผลรวม, จำนวนวันที่มีข้อมูล) → กราฟแท่งต่อวัน → กลุ่มตาม Machine (ยอดรวมที่ใช้ไป, สถานะออนไลน์/ออฟไลน์, เวลาที่ได้ล่าสุด) → แถว Agent (ยอดในช่วง, แตะไปหน้าของ Agent) → "งานที่ใช้ token มากที่สุด" 10 อัน (ชื่อ Agent + ตัวอย่างข้อความของ Task จากตาราง `task`; ที่ไม่รู้จักแสดงรหัส 8 ตัวแรก; ส่วนที่เหลือของ 20 อันเป็น "อื่น ๆ")
- Machine total เป็น "ใช้ไป" ไม่มีตัวหาร Budget และไม่มีเปอร์เซ็นต์ในมุมมองหลายวัน; เปอร์เซ็นต์ของวันนี้ยังอยู่ที่หน้าของ Agent
- กราฟ: shared component ใน `shared/ui` ที่รับค่าเป็นสัดส่วนแล้ววาดด้วย `View` (ไม่ใช้ SVG) แต่ละแท่งมี `role`/`aria-label` บอกวันที่กับจำนวน token หรือ "ไม่มีข้อมูล"; วันที่ที่ไม่มีแถววาดเป็นร่องว่าง ไม่ใช่แท่งศูนย์
- คำทุกคำอยู่ใน `pages/usage/i18n/{th,en}.json`, แถวใน Workspace อยู่ใน `pages/workspace/i18n`, และ `usage.invalid_range` อยู่ใน `shared/i18n/errors` ทั้งสองภาษา

ทางเลือกที่ตัดออก: ใช้ `react-native-svg` (เกินจำเป็นสำหรับแท่ง), ทำกราฟในหน้าของ Agent (หน้าของ Agent ตอบเรื่องวันนี้ ไม่ใช่แนวโน้ม), ให้หน้านี้ตั้ง Budget (จะซ้ำกับหน้าของ Agent และต้องมี validation ชุดที่สอง)

## Risks / Trade-offs

- [เขียน SQLite ทุกคำตอบ] → แถวเล็กและการเขียนครั้งเดียวต่อคำตอบ ถ้าดิสก์เต็มหรือเขียนไม่ผ่าน ให้ log แล้วตอบคำตอบของ Provider ต่อไปโดยไม่ทำให้ Turn พัง; ยอดที่หายจะเห็นได้จากยอดที่ไม่ขยับ และ Budget ยังกันงานวนได้ด้วยยอดเดิม
- [ยอดสองที่ช่วงเปลี่ยนผ่าน] → นำเข้า `usage.json` ครั้งเดียวแล้วเปลี่ยนชื่อไฟล์; ถ้า import ไม่ผ่าน supervisor ไม่เริ่ม เพื่อไม่ให้ยอดหายเงียบ ๆ
- [หลาย Machine อยู่คนละเขตเวลา] → Machine คำนวณ `from`/`to` เอง หน้าแสดงวันที่ตามที่ได้มาและไม่เทียบข้ามเครื่องเป็นวันเดียวกัน
- [gateway ไม่รายงาน `usage`] → ไม่มีแถวและไม่มีแท่งสำหรับวันนั้น; ตัวเลขรวมจึงเป็นยอดที่รู้ ไม่ใช่ยอดที่ใช้จริงทั้งหมด (ADR 0043 ยอมรับไว้)
- [Task ในประวัติไม่มีในฐานข้อมูลของ Controller] → แสดงรหัสสั้น; เมื่อมีหลาย Member อาจเห็นรหัสของ Task ที่เปิดไม่ได้ ซึ่ง v0.1 มี Owner คนเดียวและจะต้องกรองตาม ADR 0060 เมื่อมีคนอื่น
- [แคชแยกตามเครื่อง] → สองอุปกรณ์เห็นประวัติไม่เท่ากันจนกว่าจะได้คำตอบจาก Machine; หน้าแสดงเวลาที่ได้ล่าสุดเพื่อไม่หลอกว่าเป็นของสด
- [30 วันคงที่] → พอสำหรับแนวโน้ม แต่ยอดเก่ากว่านั้นหาย; เพิ่มการตั้งค่าเมื่อมีคนขอ โดยไม่ต้องเปลี่ยน schema

## Migration Plan

1. เปิด `usage.db` ครั้งแรก: สร้างตาราง, `chmod 0600`, ถ้าตารางว่างและมี `usage.json` ให้นำเข้าแล้วเปลี่ยนชื่อเป็น `usage.json.migrated`
2. ถอยกลับได้โดยเก็บไฟล์ `.migrated` ไว้ แต่ประวัติที่เกิดหลังเปลี่ยนจะไม่กลับไปอยู่ใน `usage.json`
3. Controller: migration แบบ append-only เพิ่ม `usage_day` กับ `machine.usage_fetched_at`; ฐานข้อมูลเก่าอัปเดตเองก่อนหน้าจออ่าน
4. ไม่ต้อง Pair ใหม่และไม่ต้องแก้ Hub

## Open Questions

- อยากเก็บนานกว่า 30 วันหรือตั้งค่าได้หรือไม่ — เพิ่มภายหลังได้โดยไม่เปลี่ยน schema หรือ protocol (คำขอรับ `days` ถึง 90 อยู่แล้ว)
