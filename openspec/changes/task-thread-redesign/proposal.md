## Why

หน้า Task เป็นหน้าที่ Owner ใช้มากที่สุด และเป็นหน้าที่ห่างจากแบบใหม่บน canvas มากที่สุด:

- **ชื่อ tool ถูกทิ้ง:** log แสดงทุก tool เป็นบรรทัดคำสั่งแบบเดียวกัน เพราะ `items.ts` เก็บแค่ `command` Agent ที่อ่านไฟล์ แก้ไฟล์ หรือค้นหาจึงดูเหมือนรันคำสั่งทั้งหมด
- **กลุ่ม tool ยาวเกินไป:** กลุ่มที่รันติดกันหลายตัวแสดงจำนวนและผลรวม แต่ไม่บอกว่ากำลังทำอะไรอยู่ตอนนี้
- **ไม่มีสรุปไฟล์:** จบ Turn แล้วไม่รู้ว่า Agent แก้ไฟล์ไหนบ้าง ถ้าไม่เปิดดูทีละคำสั่ง
- **ไฟล์เดียวทำทุกอย่าง:** `TaskPage.tsx` (441 บรรทัด, `View` 43 ตัว, `style` 29 ที่) รวมการหาข้อมูล การส่ง การหยุด การแนบไฟล์ และการวาดไว้ในฟังก์ชันเดียว และเป็นข้อยกเว้นชั่วคราวของกฎการใช้ element ที่ `controller-theme` ตั้งไว้

## What Changes

- **Tool group:**
  - หุบเป็นค่าเริ่มต้น และแสดง action ล่าสุดในรูปที่อ่านง่ายตามชนิดของ tool ("อ่าน `client.rs`", "แก้ `relay.rs`", "ค้นหา `timeout`", "รัน `cargo test`") พร้อมจำนวนที่ซ่อนอยู่
  - กลุ่มที่มี tool ล้มเหลวแสดง tool ที่ล้มเหลวกับบรรทัด error แทน
- **ข้อมูล tool:** `items.ts` เก็บชื่อ tool และเป้าหมาย (path, pattern, คำสั่ง) ของทุก call ครบทั้งแปดชนิดของ Runtime (`bash`, `read`, `glob`, `grep`, `edit`, `write`, `memory`, `send_file`)
- **สรุปไฟล์ต่อ Turn:** เมื่อ Turn จบ แสดงแถวสรุปไฟล์ที่ `edit` และ `write` แตะใน Turn นั้น กดดูรายชื่อได้
- **Header:** Character ของ Agent ย้ายจากหัวของ log ไปอยู่ใน header ซ้ายชื่อ Agent พร้อมสถานะใต้ชื่อ ตามแบบ
- **หน้าตาตามแถวแชตบน canvas:**
  - bubble ของ Owner เป็นสีหมึก
  - ข้อความของ Agent ไม่มี bubble
  - เหตุการณ์ต่างๆ เป็นบรรทัดกลางจอ
  - ข้อความที่รอคิวจางลงพร้อมลำดับ
  - การ์ด Approval เป็นสีของ Agent พร้อม Character ลอยบนการ์ด
  - composer เป็นช่องลอย
- **แยก `TaskPage.tsx`:**
  - ข้อมูลและการตัดสินใจไปอยู่ใน `pages/task/model/` เป็นฟังก์ชันล้วนที่มี test
  - การวาดแยกเป็นไฟล์ละส่วน (Message, ToolGroup, ApprovalCard, Composer)
  - ลบข้อยกเว้นชั่วคราวของ `pages/task/ui` ออกจากกฎการใช้ element
- **ไม่เปลี่ยน:** การส่ง การหยุด การแนบไฟล์ คิวข้อความ และการตอบ Approval ทำงานเหมือนเดิม

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `controller-tasks`:
  - **การแสดง tool:** จากบรรทัดคำสั่งเป็นกลุ่มที่หุบไว้และบอก action ล่าสุดตามชนิดของ tool
  - **ที่อยู่ของ Character:** ย้ายจากหัวของ log ไปที่ header
  - **ใหม่:** สรุปไฟล์ที่แก้เมื่อ Turn จบ

## Impact

- **Controller:**
  - `src/pages/task/` ทั้งโฟลเดอร์ (`model/items.ts`, `ui/*`)
  - ข้อความใน `src/pages/task/i18n/th.json` และ `en.json` สำหรับคำกริยาของแต่ละ tool
  - `.conventions/rules.json`: ลบข้อยกเว้นของ `pages/task/ui`
- **Runtime, Protocol, Hub:** ไม่เปลี่ยน ชื่อ tool และ input อยู่ใน `llm.message` แล้ว
- **ขึ้นกับ:** `controller-theme` (ชิ้นใน `shared/ui`) และ `character-look` (Mood ล้มเหลวที่ header ใช้)
- **ต่อกับ:** `live-tool-output` จะเติม output สดและสถานะค้างลงใน ToolGroup ที่ change นี้สร้าง
