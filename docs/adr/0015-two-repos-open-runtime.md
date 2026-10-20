---
status: superseded by ADR-0025
---

# แยกเป็นสอง repo: repo เปิดมี protocol กับ Runtime ส่วน repo ปิดมี Hub กับ Controller

Runtime คือโปรแกรมที่ลูกค้าติดตั้งบนเครื่องของตัวเองและให้สิทธิ์รันคำสั่ง การเปิด source ตั้งแต่วันแรกทำให้ลูกค้าตรวจได้ว่ามันทำอะไรบ้าง ซึ่งเป็นจุดขายเรื่องความไว้ใจ repo เปิดจึงมี Protocol library กับ Runtime ส่วน Hub กับ Controller อยู่ใน repo ปิด Protocol library publish ขึ้น npm แบบสาธารณะพร้อมเวอร์ชันแบบ semver และ Controller ดึงไปใช้ตามเวอร์ชัน ส่วน struct หัวซองฝั่ง Go ยังเขียนซ้ำไว้ใน Hub ตามเดิม (ADR 0007)

repo เปิด (`veeloe`) มี `packages/protocol` ซึ่งเป็น `@veeloe/protocol` บน npm กับ `packages/runtime` ซึ่งข้างในแบ่งเป็น supervisor กับ worker (ADR 0020) และมีสคริปต์ติดตั้ง ส่วน repo ปิด (`veeloe-cloud`) มี `hub/` (go-scaffold, ADR 0014) ซึ่งข้างในมี module workspace, member, controller, machine, agent, flow และ grant (Hub ต้องรู้ว่าใครมี Approve เพื่อส่ง push ให้ถูกคน) พร้อม relay กับ keyauth ที่เราเขียนเอง นอกจากนี้มี `controller/` (Expo, ADR 0021) และ `e2e/` ที่ใช้รัน test ตาม seam

OpenSpec อยู่ในแต่ละ repo เพื่อให้ spec กับ change ที่ตัดสินใจไว้ระหว่าง dev อยู่ใน git คู่กับโค้ดที่เกี่ยวข้อง ของ Protocol กับ Runtime อยู่ใน `veeloe` (public) ส่วนของ Hub กับ Controller อยู่ใน `veeloe-cloud` ถ้า change ไหนกระทบทั้งสอง repo ให้แยกเป็นสอง change ส่วนเอกสารออกแบบที่เหลือ (CONTEXT.md และ ADR) ไม่ได้อยู่ใน repo ไหนเลย แต่อยู่ในโฟลเดอร์รวมบนเครื่องของ maintainer ซึ่งไม่ใช่ git repo ข้างในโฟลเดอร์นี้มี repo ปิด `veeloe-cloud/` (บน GitHub คือ `NakePranob/veeloe-cloud` แบบ private) กับ repo เปิด `veeloe/` (บน GitHub คือ `NakePranob/veeloe` แบบ public) อยู่ข้างกัน เราเลือกแบบนี้เพื่อให้ agent ที่เปิดที่โฟลเดอร์รวมเห็นเอกสารกับทั้งสอง repo ได้ในที่เดียว และเอกสารที่มีเรื่องธุรกิจปนอยู่ (ADR 0001, 0014, 0016, 0022) จะไม่หลุดไปอยู่ใน repo ไหน ข้อเสียคือเอกสารไม่มีประวัติใน git และไม่มีสำเนาบน GitHub ต้องสำรองโฟลเดอร์นี้เอง (commit แรกของ veeloe-cloud ยังมีเอกสารชุดแรกอยู่ในประวัติ) ส่วน repo เปิด ตอนนี้มีแค่ LICENSE, README, glossary และกฎ commit กับ PR ส่วน ADR ที่เกี่ยวกับ Protocol และ Runtime จะคัดลอกไปเท่าที่จำเป็นตอนเริ่มเขียนโค้ด repo เปิดตั้ง ruleset ได้เพราะเป็น public แต่ repo ปิดตั้งไม่ได้ เพราะบัญชีใช้แผน Free

## Considered Options

- **repo เดียว แล้วแยกออกทีหลังด้วย git filter-repo**: แก้ protocol ทีเดียวได้ครบทุกฝั่งใน commit เดียว แต่ยังเปิด source ของ Runtime ไม่ได้จนกว่าจะแยก
- **ห้า repo แยกตามส่วน**: release แยกกันได้อิสระที่สุด แต่แก้ protocol ครั้งเดียวต้องทำ 4-5 PR

## Consequences

- แก้ protocol ครั้งหนึ่งต้องทำอย่างน้อยสอง PR: publish protocol ใน repo เปิดก่อน แล้วค่อย bump ใน repo ปิด
- test ตาม seam ต้องอยู่ใน repo ปิด เพราะต้องใช้ Hub ตัวจริง CI ของ repo ปิดจะดึง Runtime ตามเวอร์ชันที่ pin ไว้ ส่วนคนที่ส่ง PR เข้า repo เปิดรัน test ตาม seam เองไม่ได้
- กุญแจที่ใช้เซ็น release ของ Runtime (ADR 0009) ใช้อยู่ใน CI ของ repo สาธารณะ จึงต้องเก็บไว้ใน environment ที่มีการป้องกัน ต้องมีคนกดอนุมัติก่อนเซ็นทุกครั้ง และ PR จาก fork ต้องเข้าถึงไม่ได้
