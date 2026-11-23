## Why

หลัง `controller-theme`, `character-look` และ `task-thread-redesign` หน้าที่เหลือจะได้สีและชิ้นใหม่แล้ว แต่โครงยังเป็นแบบเดิม ส่วนแบบบน canvas ยังมีของที่หน้าเดิมไม่มี:

- **Inbox:** ยังเรียงทุก Agent ในรายการเดียว Owner ที่มี Agent หลายตัวต้องไล่หาว่าตัวไหนรอตัวเองอยู่
- **หน้า Machine ทีละเครื่อง:** แบบใหม่มีส่วนบนพร้อมสรุปตัวเลข และแสดง Agent ด้วย Character
- **หน้าตั้งค่าของ Agent:** แบบใหม่มีป้าย Machine กับ model ใต้หัว และสถานะของ Task ด้วยไอคอน
- **หน้าเริ่มต้น:** แบบใหม่มี Character ตัวใหญ่

change นี้ทำทุกหน้าที่เหลือให้ตรงกับ canvas ทีละกลุ่ม และเป็นที่เดียวที่ Inbox ได้แท็บตามสถานะ

## What Changes

- **Inbox:**
  - มีแท็บ ทั้งหมด / รอคุณ / ทำงาน / เสร็จ พร้อมจำนวนในแท็บรอคุณและทำงาน
  - แถวใช้ Character ขนาดใหญ่ บรรทัดสถานะมีสี และข้อความล่าสุด
  - แท็บที่ว่างบอกว่าไม่มี Agent ในสถานะนั้น
- **กลุ่ม Agent:** หน้า Agent, แก้ Character (ส่วนที่เหลือจาก `character-look`), Memory, Provider และ model, Allowlist, git repo, สร้าง Agent
- **กลุ่ม Workspace:** Workspace, Agent ทั้งหมด, Machine, Machine ทีละเครื่อง, การใช้ token, เครื่องของฉัน
- **กลุ่มเริ่มต้นและระบบ:** หน้าแรกตอนยังไม่มี Machine, ผูก Machine, Link เครื่องใหม่, Link เครื่องนี้, สร้างกุญแจ, ล็อก, เปิดอยู่อีกแท็บ, ที่เก็บข้อมูลใช้ไม่ได้
- **แต่ละกลุ่มเริ่มเขียนโค้ดได้เมื่อแบบครบ:** กระดานของทุกหน้าในกลุ่มต้องมีครบทุก state ที่โค้ดมี (โหลด, ว่าง, error, ออฟไลน์, ไม่มีสิทธิ์) ทั้งโหมดสว่างและมืด ตอนนี้กระดานยังขาดหลาย state ที่ตัวช่วยวาดตัดไป
- **ไม่เปลี่ยน:** พฤติกรรมของหน้าเหล่านี้นอกจากแท็บของ Inbox ไม่เปลี่ยน คำบนหน้าจอเปลี่ยนเฉพาะที่แบบใหม่ต้องการ และเปลี่ยนทั้งสองภาษาพร้อมกัน

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `controller-tasks`: Inbox มีแท็บตามสถานะ และนิยามว่าสถานะไหนอยู่แท็บไหน

## Impact

- **Controller:**
  - `src/widgets/agent-inbox`
  - `src/pages/home`, `agent`, `agent-*`, `new-agent`, `workspace`, `agents`, `machines`, `usage`, `devices`, `add-machine`, `link-device`, `link-this-device`, `create-key`, `lock`, `other-tab`, `storage-unavailable`
  - i18n ของ slice เหล่านั้น
- **canvas:** ทุกกระดานในแถว Agent, Workspace และเริ่มต้นและระบบต้องได้ state ที่ขาด และบอร์ดที่มีข้อมูลแต่งขึ้นต้องแก้ให้ตรงกับข้อมูลจริง (รหัส Link, เวลาใช้ล่าสุด, Agent "Bo", Hub URL ตัวอย่าง)
- **Runtime, Protocol, Hub:** ไม่เปลี่ยน
- **ขึ้นกับ:** `controller-theme`, `character-look` และ `task-thread-redesign` ต้องเสร็จก่อน ส่วน `agent-memory-page` และ `push-notifications` ควรปิดก่อนเริ่มกลุ่มที่แตะหน้าเดียวกัน
