## Why

Change นี้ทำตาม issue #7 (Runtime connects to the Hub and proves its key) ตอนนี้ Protocol, Hub และ Runtime มีแค่โครงจาก #6 ยังไม่มีซองข้อความ ยังไม่มีการพิสูจน์ตัวตน และ Hub ยังไม่รู้ว่า Machine ไหนออนไลน์ งานนี้เป็นเส้นแรกที่ทั้งสามส่วนคุยกันจริง และตั๋วถัดไปทั้งหมด ตั้งแต่สร้าง Workspace (#8) และ Pairing (#9) เป็นต้นไป ต้องใช้ทั้งซองและการต่อเข้า Hub แบบนี้

ส่วนที่แตะ: **Protocol, Hub และ Runtime** (ไม่แตะ Controller) พร้อม e2e

ADR ที่ใช้: 0001 (Runtime เปิดสายออกไปหา Hub ทางเดียว), 0007 (Hub เป็น Go และอ่านแค่หัวซอง), 0012 (Ed25519 ด้วย @noble และไฟล์กุญแจสิทธิ์ 0600), 0013 (กุญแจคือตัวตน และข้อความสุ่มอยู่ใน frame แรก), 0014 (Hub บน go-scaffold กับ Postgres), 0019 (เซ็นตาม byte จริง มีสำเนาหัวซองกับเลขต่อผู้ส่ง), 0020 (supervisor เป็นคนต่อ Hub), 0022 (relay เป็น module ของ scaffold, keyauth รับฟังก์ชันหากุญแจ, presence อยู่ในหน่วยความจำ), 0023 (เพิ่มได้อย่างเดียว และฝั่งรับข้ามสิ่งที่ไม่รู้จัก)

## What Changes

- **Protocol:** มีซองที่ฝั่งส่ง serialize เนื้อในเป็น byte ครั้งเดียวแล้วเซ็น byte ชุดนั้น ส่วนที่เซ็นมีสำเนาของปลายทาง, Task id และ Member ต้นทาง พร้อมเลขที่เพิ่มขึ้นต่อผู้ส่ง ฝั่งรับตรวจลายเซ็นก่อน แล้วค่อย parse ด้วย Zod แบบไม่ strict ตรวจว่าหัวซองตรงกับสำเนาที่เซ็น และตรวจว่าเลขมากกว่าเลขล่าสุดของกุญแจนั้น ฝั่งรับข้ามชนิดข้อความที่ไม่รู้จักโดยไม่พัง Protocol มีข้อความสำหรับจับมือกับ Hub (challenge, auth และ ready) export JSON Schema ของหัวซองเป็นไฟล์ และมี test vector ที่ทั้ง TypeScript และ Go ใช้ชุดเดียวกัน
- **Hub:** เพิ่ม module `machine` ที่เก็บกุญแจสาธารณะของ Machine ไว้ใน Postgres ซึ่งเป็น migration แรกของ Hub module `relay` รับ WebSocket แล้วส่งข้อความสุ่มใน frame แรก จากนั้นรับเฉพาะลายเซ็น Ed25519 ที่ถูกต้องจากกุญแจที่รู้จัก ปิดสายเมื่อไม่ผ่านหรือตอบช้าเกินกำหนด เก็บ presence ของ Machine ไว้ในหน่วยความจำ และรู้ทันทีเมื่อหลุด ทั้งตอนสายปิดและตอน heartbeat ไม่ตอบ Go test ตรวจว่า struct ของหัวซองตรงกับ JSON Schema และตรวจ test vector
- **Runtime:** supervisor สร้างกุญแจ Ed25519 ของ Machine ในครั้งแรก แล้วโหลดใช้ในครั้งถัดไป (เก็บเป็นไฟล์สิทธิ์ 0600) ตั้ง URL ของ Hub ได้ hub-link ต่อเข้า Hub ตอบข้อความสุ่ม และต่อใหม่เองแบบ backoff เมื่อสายหลุด
- **e2e:** seed กุญแจของ Machine ลง Postgres แล้วรัน binary ของ Runtime ตัวจริง Runtime ต่อได้และ Hub แสดงว่าออนไลน์ ส่วนลายเซ็นผิด กุญแจที่ไม่รู้จัก และคำตอบ challenge เก่าที่ส่งซ้ำ ถูกปฏิเสธ เมื่อ Hub restart แล้ว Runtime ต่อกลับเอง

**ขอบเขตที่ตกลงแล้ว (ย้ายไปเพิ่มใน acceptance criteria ของ #9 แล้ว):** acceptance criteria ข้อสุดท้ายของ #7 ระบุว่า "เลขซ้ำถูกปฏิเสธ" ใน e2e แต่เลขต่อผู้ส่งเป็นสิ่งที่ฝั่งรับข้อความที่เซ็นแล้วเป็นคนตรวจ (ADR 0019) ซึ่งใน #7 ยังไม่มีข้อความที่เซ็นแล้ววิ่งไปถึง Runtime เลย เพราะ Controller มาใน #8 และ Pairing มาใน #9 ส่วน Hub ก็ห้ามส่งต่อข้อความระหว่าง Machine โดยไม่มีเส้นใน Flow (ADR 0003) change นี้จึงตรวจเลขซ้ำด้วย unit test ของ Protocol และ test vector ร่วม ส่วนใน e2e ตรวจการส่งคำตอบ challenge ซ้ำแทน e2e ของคำสั่งที่ส่งซ้ำจะไปอยู่ใน #9 ซึ่งเป็นตั๋วแรกที่คำสั่งที่เซ็นแล้ววิ่งถึง Runtime

**ไม่อยู่ใน change นี้:** การส่งต่อซองระหว่างสาย, Controller, Pairing, endpoint HTTP ของ Machine และการต่อ FK ไปที่ตาราง Workspace ซึ่งจะมาใน #8

## Capabilities

### New Capabilities
- `protocol-envelope`: ซองที่เซ็นแล้ว ขั้นตอนที่ฝั่งรับต้องตรวจ เลขต่อผู้ส่ง การข้ามสิ่งที่ไม่รู้จัก JSON Schema ของหัวซอง และ test vector
- `hub-connection`: การต่อเข้า Hub ด้วย WebSocket การพิสูจน์ตัวตนด้วยข้อความสุ่มใน frame แรก และ presence ของ Machine
- `runtime-hub-link`: กุญแจของ Machine, URL ของ Hub และการต่อกับต่อใหม่ของ Runtime

### Modified Capabilities
(ไม่มี ยังไม่มี spec เดิม)

## Impact

- **dependency ใหม่:** `zod` (v4) และ `@noble/curves` ใน Protocol และ `github.com/coder/websocket` ใน Hub (ตัวเดียวกับที่ใช้ใน spike ของ ADR 0022)
- **schema ของ Hub:** migration แรกสร้างตาราง `machines` ส่วน e2e ต้องรัน migration ก่อนเปิด Hub
- **config ใหม่:** Hub มี URL สาธารณะของตัวเองไว้ผูกกับลายเซ็นตอนจับมือ, timeout ของการจับมือ และช่วงเวลาของ heartbeat ส่วน Runtime มีโฟลเดอร์ของ Runtime กับ URL ของ Hub
- **CI:** job ของ Hub อ่าน JSON Schema กับ test vector จาก `packages/protocol` ด้วย
