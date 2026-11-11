## Context

- **Protocol:** `packages/protocol/src/messages.rs` ตรวจ message ทุกชนิด; `packages/protocol-ts/src/messages/task.ts` และ `packages/protocol-ts/src/messages/index.ts` เป็นฝ่าย TypeScript
- **Runtime:** `packages/runtime/crates/runtime-supervisor/src/tasks.rs` รับ `task.message` และส่งต่อ worker; `runtime-core/src/agent.rs` เขียน event `approval.requested` และ `turn.ended`; `runtime-supervisor/src/trust.rs` ถือ Owner และรายการกุญแจที่ถูกถอน
- **Controller:** `controller/src/features/machine-link/model/links.ts` ถือ connection ต่อ Hub และส่งคำสั่งที่เซ็นแล้ว; `controller/src/app/layouts/RootLayout.tsx` มี alert ในแอปที่ใช้แทน push อยู่ตอนนี้
- **Hub:** `hub/` เป็น relay เท่านั้น ไม่มีที่เก็บ token หรือเนื้อหา push; change นี้ไม่แก้ Hub
- **ADR:** 0044 กำหนดผู้รับ, 0012 กำหนดการยืนยันตัวก่อนอนุมัติ, 0005 กำหนดว่า Hub ไม่เก็บเนื้อหา, 0053 กำหนดการ sync ค่าระหว่างเครื่อง

## Terminology

- **Push Token**: token ของ Expo Push Service รูป `ExponentPushToken[...]` ที่ผูกกับ Controller เครื่องหนึ่ง
- **Token Record**: ข้อมูลที่ Runtime เก็บต่อ Member ต่อ Controller: token, ภาษา (`th` หรือ `en`) และเวลาที่ลงทะเบียน
- **Generic Push**: ข้อความกลางๆ ที่ไม่เปิดเผยเนื้อหา Task เช่น “มี Approval รออยู่” หรือ “งานเสร็จแล้ว”
- **Active Task**: Task ที่ Controller กำลังเปิดอยู่และมองเห็นอยู่จริง

## Decisions

### 1. ใช้ Expo Push Service

**Decision:** ส่งผ่าน `https://exp.host/--/api/v2/push/send`

**Why:** รองรับ APNs/FCM ให้แล้ว, ไม่มีค่าส่ง, และ Controller ใช้ `expo-notifications` อยู่แล้ว

**Rejected:** APNs/FCM ตรง — ต้องถือ key/cert สองระบบและเขียน client สองชุด; ยังไม่คุ้มกับ v0.1

### 2. Runtime ถือ token และเป็นคนส่ง push

**Decision:** Controller ส่ง token ให้ Machine ที่ผูกอยู่; Runtime เก็บ Token Record และเรียก Expo เอง

**Why:** Runtime เป็นเจ้าของ Grant และรู้ว่าใครควรได้รับ Approval/Turn ไหน; Hub จึงไม่ต้องรู้ token และยังไม่เก็บเนื้อหา

**Rejected:** ให้ Hub เก็บ token และส่ง push — Hub จะต้องรู้ Member/Agent/สิทธิ์ ซึ่งขัด ADR 0005 และบทบาท relay

### 3. ลงทะเบียนด้วยข้อความที่เซ็นแล้ว

**Decision:** เพิ่ม `push.register` และ `push.unregister` เป็นข้อความ Controller → Machine ผ่าน Hub ตามทางเดิม

**Why:** ใช้ trust และลายเซ็นเดิม; ไม่เพิ่ม HTTP endpoint หรือ credential ใหม่ที่ Hub

**Rejected:** `POST /push-tokens` ที่ Hub — ต้องมี authentication สำหรับ Controller เพิ่ม และทำให้ Hub เก็บ token

Token Record ผูกกับกุญแจ Controller ที่เซ็นข้อความ ไม่ใช่ชื่อเครื่อง; `push.unregister` และการถอนกุญแจลบ record ของกุญแจนั้น

### 4. เนื้อหาเป็น Generic Push

**Decision:** title/body เลือกจากภาษาใน Token Record; `data` มีเฉพาะ `kind`, `agent`, `task` และ `approval` เมื่อมี

**Why:** ผู้ใช้เห็นข้อความที่มีความหมายขณะแอปปิด โดยไม่ส่งข้อความ Task ชื่อไฟล์ หรือชื่อ Agent ผ่าน Expo/APNs/FCM

**Rejected:** ส่งข้อความ Task จริง — ผิด ADR 0005 ก่อนมี E2E

### 5. Trigger รอบแรก: Approval และ Turn จบ

**Decision:** ส่งเมื่อ `approval.requested` ถึงคนที่มี Approve ที่ Agent และเมื่อ `turn.ended` ถึง Member ที่เริ่ม Turn

**Why:** เป็นสองเหตุที่คนรออยู่จริงและมีข้อมูลพอใน Runtime; Budget/Mention/Linking ต้องมี infrastructure เพิ่ม

**Rejected:** ส่งทุก event — spam และยังไม่มีผู้รับที่ชัดเจนสำหรับทุกชนิด

### 6. Controller ลงทะเบียนทุกครั้งที่ต่อ Hub

**Decision:** หลังได้ token และทุกครั้งที่ `hello` สำเร็จ ให้ส่ง `push.register` ซ้ำได้; Runtime เขียนทับ record เดิมของกุญแจนั้น

**Why:** token เปลี่ยนได้เมื่อติดตั้งใหม่หรือเปลี่ยน project; การลงทะเบียนซ้ำทำให้หายจากสายหลุด

**Rejected:** ลงทะเบียนครั้งเดียวตอนเปิดแอป — token เก่าจะค้างหลังเปลี่ยนเครื่อง

### 7. Foreground ไม่แสดง banner ซ้ำ

**Decision:** `setNotificationHandler` ไม่แสดง banner เมื่อ Controller กำลังเปิด Active Task เดียวกัน; ยังบันทึกและอัปเดต state ตามปกติ

**Why:** ADR 0044 ส่ง Turn จบเฉพาะตอนไม่ได้เปิดแอปอยู่; การซ่อน banner ในแอปทำให้ไม่รบกวนผู้ใช้ที่กำลังดูอยู่

**Rejected:** ให้ OS แสดงทุกครั้ง — ผู้ใช้เห็นซ้ำทั้งในแอปและ notification

### 8. ไม่ retry push แบบไม่มีที่สิ้นสุด

**Decision:** ส่งครั้งเดียวต่อ event; ถ้า Expo ตอบ `DeviceNotRegistered` ให้ลบ Token Record; error อื่นบันทึก log แบบไม่มีเนื้อหาและไม่ทำให้ Turn ล้ม

**Why:** push เป็น best-effort; Task ต้องไม่พังเพราะ notification

**Rejected:** retry จนสำเร็จ — อาจยิงซ้ำและทำให้ผู้ใช้เห็นหลายครั้ง

## API Contract

### `push.register`

```json
{
  "type": "push.register",
  "body": {
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "language": "th"
  }
}
```

- `token` ต้องขึ้นต้นด้วย `ExponentPushToken[` และปิดด้วย `]`; ยาวไม่เกิน 256
- `language` เป็น `th` หรือ `en`; ค่าอื่นใช้ `en`
- ตอบกลับด้วย `push.registered` ที่มี `token` เดิม หรือ `error` code `push.invalid`

### `push.unregister`

```json
{ "type": "push.unregister", "body": {} }
```

ลบ Token Record ของกุญแจที่เซ็นข้อความนั้น; ตอบ `push.unregistered`

### Generic Push

```json
{
  "to": "ExponentPushToken[...]",
  "title": "Veeloe",
  "body": "มี Approval รออยู่",
  "data": { "kind": "approval", "agent": "a1", "task": "t1", "approval": "ap_..." },
  "sound": "default"
}
```

## Risks

- Expo project ID และ credentials ยังไม่มี; QA เครื่องจริงทำไม่ได้จนกว่าจะตั้งค่า
- Expo ไม่รับประกันการถึงเครื่อง; แอปต้องยัง sync สถานะเมื่อเปิด
- Token อาจค้างถ้าผู้ใช้ลบแอปโดยไม่มีการถอนกุญแจ; receipts จะลบเมื่อ Expo บอก `DeviceNotRegistered`
- การปิด push เฉพาะ Agent และการ sync ระหว่างเครื่องตาม ADR 0044/0053 ยังไม่ทำใน change นี้; ต้องมี change ต่อก่อนออก v0.1
- Agent ที่โดนหลอกให้สร้าง Approval ถี่สามารถสร้าง push ถี่ได้; รอบนี้ยังไม่มี coalescing ต่อ Task

## Open decisions

- การปิด push ต่อ Agent และการ sync ค่าระหว่างเครื่องยังไม่ตัดสินว่าจะทำใน `push-settings` หรือรวมใน change นี้ก่อน archive; change นี้จึงยังไม่ปิด ADR 0044 ทั้งข้อ
