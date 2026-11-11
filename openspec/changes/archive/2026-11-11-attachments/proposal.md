## Why

ผู้ใช้ต้องส่ง screenshot, log หรือไฟล์ให้ Agent ใน Task และ Agent ต้องอ่านไฟล์นั้นได้จาก Workdir โดยไม่ให้ Hub เก็บเนื้อหา (ADR 0050) v0.1 เริ่มจากทางส่ง Controller → Machine ก่อน

## What Changes

- Controller เลือกไฟล์และส่งเป็น `file.chunk` ก้อนละ 256 KiB ก่อน `task.message`
- `task.message` ประกาศ `{name,size,hash}` ของไฟล์
- Runtime ประกอบก้อน ตรวจ hash, จำกัด 20 MB และเขียนลง `workdir/attachments/<task>/`
- ข้อความที่ Agent เห็นมีรายการ path ของไฟล์แนบ
- UI มีปุ่ม paperclip, chip ไฟล์แนบ และลบไฟล์ก่อนส่งได้

## Capabilities

### New Capabilities

- `task-attachments`: ส่งไฟล์เข้า Task และให้ Agent อ่านจาก Workdir

### Modified Capabilities

- `runtime-tasks`: รับ `file.chunk` และแนบไฟล์ใน `task.message`
- `controller-composer`: ปุ่มแนบไฟล์และ chip

## Non-goals

- `send_file` จาก Agent กลับ Controller (รอบนี้เพิ่ม tool + file card + `file.get`/chunk กลับ)
- Attachment ใน Channel/Telegram
- Resume chunk หลังสายหลุด; รอบนี้ส่งใหม่ทั้งไฟล์
- เปิด PDF/docx ในแอปด้วย native viewer (รอบนี้ใช้ OS เปิดไฟล์)

## Impact

- **Protocol:** `file.chunk`, `attachments` ใน `task.message`
- **Runtime:** `Uploads` in-memory, hash check, 20 MB cap, Workdir placement
- **Controller:** `expo-document-picker`, `links.sendAttachment`, composer UI
- **Hub:** relay only; no storage

## Acceptance anchor cases

- เลือกไฟล์แล้วเห็น chip ก่อนส่ง
- ส่งแล้ว Agent ได้ path ใน Workdir และตอบกลับ
- hash ไม่ตรงถูกปฏิเสธ
- ไฟล์เกิน 20 MB ถูกปฏิเสธ
- Hub ไม่เก็บไฟล์
