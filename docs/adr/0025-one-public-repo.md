# รวมทุกอย่างไว้ใน repo เดียวแบบ public

เราเลือกเปิด source ทั้งหมด รวมทั้ง Hub และ Controller เหตุผลเดียวที่แยกเป็นสอง repo (ADR 0015) คือต้องปิด Hub กับ Controller ไว้ พอเปิดหมด เหตุผลนั้นก็หายไป ทุกอย่างจึงรวมอยู่ใน `veeloe` (บน GitHub คือ `NakePranob/veeloe` แบบ public, AGPL-3.0 ตาม ADR 0016) ได้แก่ `packages/protocol`, `packages/runtime`, `hub/`, `controller/`, `e2e/`, OpenSpec ชุดเดียว และเอกสารออกแบบ (`CONTEXT.md` กับ `docs/adr/`) ซึ่งตอนนี้มีประวัติใน git และมีสำเนาบน GitHub แล้ว เรื่องธุรกิจในเอกสาร เช่น การคิดเงิน (ADR 0001) และการขาย (ADR 0024) เปิดได้ เพราะยังไงก็ต้องขึ้นหน้าราคาอยู่แล้ว

`veeloe-cloud` ไม่เปลี่ยนเป็น public เพราะ commit แรกยังมีเอกสารชุดแรกอยู่ เราจึงไม่ย้ายประวัติของมันมา และ archive repo นั้นไว้แทน ตอนตัดสินใจ repo นั้นมีแค่ไฟล์กฎ ยังไม่มีโค้ด

## Considered Options

- **แยกสอง repo ตามเดิม (ADR 0015)**: Hub กับ Controller ยังปิดได้ แต่แก้ Protocol ครั้งหนึ่งต้องทำสอง PR คนนอกรัน test ตาม seam ไม่ได้ และเอกสารไม่มีประวัติ
- **เปลี่ยน `veeloe-cloud` เป็น public แล้วใช้ repo นั้น**: ไม่ต้องย้ายไฟล์ แต่ประวัติมีเอกสารชุดแรกที่ยังไม่ได้ตรวจว่าเปิดได้

## Consequences

- แก้ Protocol ครั้งเดียวจบใน PR เดียว Runtime กับ Controller ใช้ `packages/protocol` ผ่าน workspace ไม่ต้องรอ publish และหัวซองฝั่ง Go (ADR 0007) ตรวจกับ test vector ชุดเดียวกับฝั่ง TypeScript
- test ตาม seam (ADR 0022) อยู่ใน repo เดียวกับทุกส่วน คนนอกที่ส่ง PR จึงรันเองได้
- GitHub Releases ใช้กับ Runtime อย่างเดียว เพื่อให้ release ล่าสุดของ repo เป็นของ Runtime เสมอ (ADR 0009) ส่วน Hub ออกเป็น image บน GHCR และ Controller ออกผ่าน EAS
- secret ทุกตัวอยู่นอก git ได้แก่ กุญแจเซ็น release ของ Runtime, credential ของ push และ Expo, key ของระบบเก็บเงิน และค่า env ของ Hub ตัวจริง กุญแจเซ็น release อยู่ใน environment ที่ต้องมีคนกดอนุมัติก่อนเซ็นทุกครั้ง และ PR จาก fork เข้าถึงไม่ได้
- ทุกอย่างที่เขียนลง repo เป็นสาธารณะ รวมถึง ADR ที่เขียนต่อจากนี้ด้วย
