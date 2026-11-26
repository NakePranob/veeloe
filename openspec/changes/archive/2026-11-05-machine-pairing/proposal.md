## Why

ตอนนี้ Controller มีกุญแจแล้วและ Hub ส่งต่อซองได้ แต่ยังไม่มีทางที่ Machine กับ Controller จะรู้จักกันจริง Hub ยังไม่มีทางเขียนกุญแจลงตาราง และ Runtime ยังไม่มีในโค้ดปัจจุบัน `agent-and-task` กับทุก change หลังจากนี้จึงเริ่มไม่ได้

Pairing เป็นจุดที่ Runtime เริ่มเชื่อกุญแจของ Owner ถ้า Hub ที่โดนเจาะสลับกุญแจตรงนี้ได้ ก็จะสั่งรันคำสั่งบนเครื่องของลูกค้าได้ (ADR 0006, 0013)

## What Changes

- กู้ `packages/runtime` จาก `33deb1a~1` ได้แก่ กุญแจ Machine, config และ hub-link พร้อมตัวตรวจ dependency-cruiser ใน `check` (ADR 0022)
- เพิ่ม `veeloe pair` ที่แสดง QR กับลิงก์ใน terminal และ `veeloe unpair` ที่เริ่มเครื่องใหม่จากศูนย์ (ADR 0031)
- เพิ่ม `POST /pairings` ที่ Hub ซึ่งสร้าง Workspace กับ Member เมื่อเป็น Controller ใหม่ และลงทะเบียน Machine เมื่อทั้งสองฝั่งเซ็นยินยอม (ADR 0013)
- เพิ่มข้อความ `pairing.claim` กับ `pairing.done` ใน Protocol พร้อม vector โดยพิสูจน์กุญแจด้วยรหัสลับจาก QR ที่ Hub ไม่เคยเห็น
- เพิ่ม protocol client ใน Controller, หน้าเพิ่ม Machine ที่สแกนหรือวางลิงก์ได้, การยืนยันตัวใหม่ก่อนทำ Pairing และรายชื่อ Machine บนหน้าแรก
- **แก้ ADR 0014:** Hub ไม่ได้เก็บรหัส Pairing เพราะรหัสอยู่แค่ใน QR ซึ่งกันไม่ให้ Hub สลับกุญแจได้

## Capabilities

### New Capabilities
- `machine-pairing`: Owner ผูก Machine เข้ากับ Workspace อย่างไร โดยที่ Hub สลับกุญแจของทั้งสองฝั่งไม่ได้
- `runtime-hub-link`: Runtime เก็บกุญแจของ Machine ต่อเข้า Hub และต่อใหม่เองอย่างไร

### Modified Capabilities

ไม่มี ข้อความใหม่เป็นแบบ additive ตาม `protocol-envelope` และ Hub ส่งต่อซองตาม `hub-relay` เดิม

## Impact

- **โค้ดใหม่:** `packages/runtime`, module `pairing` ใน `hub/`, `packages/protocol/src/messages/pairing-*.ts` และ slice ใหม่ใน `controller/`
- **Database:** Hub เริ่มเขียน `machine_svc.machines` กับ `controller_svc.controllers` จริง
- **Dependency ใหม่:** `uqr` ใน Runtime, `@noble/hashes` ใน Protocol และ `expo-camera` ใน Controller
- **เครื่องมือ:** `check` เพิ่ม dependency-cruiser และ job `e2e` ใน CI ต้องมี Postgres
- **ยังไม่รวม:** โควตาตอน Pairing (ADR 0001) และการย้าย Machine (ADR 0035) อยู่ใน v0.3 ส่วนการรัน Runtime เป็น service และการแจกไฟล์ที่เซ็นแล้วยังไม่ทำ
- **change ถัดไป:** `agent-and-task` ใช้กุญแจที่ไว้ใจและรายชื่อ Machine นี้ต่อ
