# Hub สร้างบน go-scaffold และใช้ Postgres ส่วน Runtime ใช้ bun:sqlite

ส่วน metadata และ REST ของ Hub (Workspace, Machine, โปรไฟล์ของ Agent, รหัส Pairing, push token) สร้างด้วย `@nakedev/go-scaffold` ซึ่งได้โครง Gin + GORM + Postgres แบบ hexagonal พร้อมคำสั่ง `check` ที่ตรวจทิศทางการเรียกกันระหว่างชั้น ใช้ `add observability` ได้ ส่วนตัวส่งต่อซองผ่าน WebSocket กับ middleware ที่ตรวจตัวตนด้วยการเซ็นข้อความสุ่ม (ADR 0013) เราเขียนเองเป็น module แยก เพราะ scaffold ไม่มีให้ Hub จึงใช้ Postgres ตั้งแต่ v0.1 ฝั่ง Runtime เก็บประวัติ Task, คิว (ADR 0011) และค่าของ Agent ไว้ใน bun:sqlite แยกไฟล์ละ Agent ส่วน supervisor มีไฟล์ของตัวเอง (ADR 0020) ซึ่งเก็บ Team กับ Flow ด้วย เพราะ Team หนึ่งมีหลาย Agent (ADR 0026)

**ห้ามรัน `go-scaffold add auth` และ `add rbac` ใน Hub** เพราะ auth ของ scaffold ใช้รหัสผ่านกับ JWT ซึ่งขัดกับ ADR 0013 และ rbac ของ scaffold ทำให้ Hub เป็นคนตัดสินสิทธิ์ ซึ่งขัดกับ ADR 0010 ที่ให้ Owner เซ็น Grant และให้ Runtime เป็นคนตรวจ `add worker` ก็ไม่ต้องใช้ เพราะ Hub ไม่มีคิว (ADR 0005)

## Considered Options

- **SQLite + sqlc ที่เขียนเอง**: Hub จะเล็กที่สุดและไม่ต้องมี Postgres ใน v0.1 แต่จะไม่ได้โครง hexagonal กับคำสั่ง `check`
- **hexagonal ที่เขียนเองทั้งหมด**: ได้ผลแบบเดียวกับ scaffold แต่ต้องเขียน boilerplate เอง
- **เก็บประวัติ Task บน Runtime เป็นไฟล์ JSONL**: คนเปิดอ่านได้เลย แต่คิวกับค่าของ Agent ต้องเก็บแยกไว้อีกที่ และต้องจัดการเองตอนไฟดับกลางทาง

## Consequences

- ตอน dev และตอนใช้งานจริงต้องมี Postgres (ตอน dev ใช้ docker compose ที่ scaffold สร้างให้) และวันที่ Hub มีหลายเครื่องก็ไม่ต้องย้าย database
- hexagonal ช่วยเรื่องจัดระเบียบโค้ด ไม่ได้ช่วยให้รับ traffic ได้มากขึ้น การรับ traffic เพิ่มยังใช้วิธีแบ่ง Workspace ไปไว้คนละเครื่องตาม ADR 0007
