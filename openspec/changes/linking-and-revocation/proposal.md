## Why

Owner ใช้มากกว่าหนึ่งเครื่อง เช่น มือถือกับเบราว์เซอร์บนโน้ตบุ๊ก แต่วันนี้ Controller แต่ละเครื่องมีกุญแจของตัวเอง และ Machine เชื่อแค่กุญแจที่ทำ Pairing ด้วย เครื่องที่สองจึงกลายเป็นอีก Workspace หนึ่ง และถ้าเครื่องเดียวที่มีหายหรือเปลี่ยน biometric ต้องไปทำ Pairing ใหม่ที่ Machine ทุกเครื่อง (ADR 0012, 0013)

ADR 0031 วาง Linking ด้วย QR และการถอนกุญแจไว้ใน v0.1 คู่กัน เพราะพอ Link เครื่องที่สองได้แล้ว เครื่องที่หายต้องถอนได้จากเครื่องที่เหลือ

## What Changes

- เครื่องใหม่สร้างกุญแจของตัวเองแล้วแสดง QR ที่มีกุญแจสาธารณะ รหัสลับ และ Hub ส่วนเครื่องเดิมสแกน ยืนยันตัวใหม่ แล้วเซ็นใบรับรองของ Linking (ADR 0013, 0031)
- เครื่องเดิมส่งรายชื่อ Machine ให้เครื่องใหม่ผ่าน Hub โดยผูกกับรหัสลับใน QR Hub จึงสลับ Machine หรือกุญแจระหว่างทางไม่ได้
- Hub ลงทะเบียนกุญแจใหม่จากใบรับรองที่เซ็นโดยกุญแจของ Member คนเดียวกัน เก็บใบรับรองเป็น metadata และส่งให้ Machine ตอนต่อเข้ามา (ADR 0005, 0031)
- Machine เชื่อกุญแจใหม่จากลายเซ็นต่อกันมาจากกุญแจที่เชื่ออยู่แล้ว ไม่ใช่เพราะ Hub บอก
- หน้า เครื่องของฉัน ใน Workspace แสดงว่าเครื่องไหน Link เครื่องไหนเมื่อไหร่ และถอนกุญแจได้ทีละเครื่อง พร้อมเลือกใบรับรองที่กุญแจนั้นเคยเซ็นและยังเก็บไว้ (ADR 0031)
- คำสั่งถอนต้องเซ็น Hub ตัดสายของกุญแจนั้นทันที และ Runtime จดลงรายชื่อห้ามของตัวเอง เครื่องสุดท้ายของ Member ถอนไม่ได้
- เครื่องใหม่ขอรายการ Task ที่ Member เริ่มไว้ด้วย `task.list` แล้วใช้ `task.sync` เดิมดึง event
- คำเตือนให้ Link เครื่องที่สองเมื่อมีเครื่องเดียว ซึ่ง `controller-device-key` เลื่อนมาไว้ที่นี่
- **แก้ `hub-relay`:** Controller ส่งซองที่มี `recipients` ได้เมื่อรายชื่อมีแค่ Member ของตัวเอง เพื่อส่งของให้เครื่องอื่นของตัวเอง ยังไม่มีทางส่งถึง Member อื่น

## Capabilities

### New Capabilities
- `device-linking`: Member เพิ่ม Controller เครื่องใหม่ของตัวเองด้วย QR อย่างไร โดยที่ Hub สลับกุญแจหรือ Machine ไม่ได้ และเครื่องใหม่ได้ Machine, Agent และ Task เดิมมาอย่างไร
- `key-revocation`: Member ถอนกุญแจของเครื่องหนึ่งอย่างไร และ Hub กับ Runtime หยุดเชื่อกุญแจนั้นอย่างไร แม้ Machine ปิดอยู่ตอนถอน

### Modified Capabilities
- `hub-relay`: Controller ส่ง `recipients` ที่มีแค่ Member ของตัวเองได้

## Impact

- **Protocol:** ลิงก์ `veeloe://link`, ใบรับรอง `device.link` กับ `device.revoke`, frame `hub.certificates`, ข้อความ `device.handoff`, `device.linked`, `task.list` และ `task.listed` พร้อม vector ทั้งหมดเป็นแบบ additive (ADR 0023)
- **Hub:** ตาราง `controller_svc.certificates`, `POST /links`, `POST /revocations`, ส่งใบรับรองหลัง `hub.ready` และตัดสายของกุญแจที่ถูกถอน
- **Runtime:** `trust.json` เพิ่ม `links` กับ `revoked` และ `pairing.claim` รับกุญแจอื่นของ Member
- **Controller:** หน้าเครื่องใหม่ที่แสดง QR, หน้าสแกนบนเครื่องเดิม, หน้า เครื่องของฉัน, ตาราง `device` และตัวสแกน QR ที่ใช้ร่วมกับ `add-machine`
- **Dependency ใหม่:** `expo-device` สำหรับชื่อเครื่องเริ่มต้น และ `uqr` ใน Controller สำหรับวาด QR
- **ลำดับ archive:** ต้อง archive `machine-pairing`, `controller-device-key` และ `agent-and-task` ก่อน เพราะ spec ของ change นี้อ้าง `pairing.claim`, กุญแจของ Controller และ `task.sync` จากสาม change นั้น
- **ยังไม่รวม:** Linking ด้วย login ทาง email, Invitation, Owner หลายคน และการลบ Member อยู่ใน v0.3 (ADR 0013, 0048) การหยุด Schedule, Idle Work, Watch, Channel และ Connector ตอนถอนกุญแจรอ change ที่สร้างของพวกนั้น การเปลี่ยนชื่อเครื่องหลัง Link และ push แจ้งเตือนตอนมีการ Link ยังไม่ทำ
