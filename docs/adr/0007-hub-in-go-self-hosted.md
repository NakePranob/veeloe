# Hub เขียนด้วย Go และเรา host เอง

ทั้งระบบเขียนด้วย TypeScript ยกเว้น Hub ตาม ADR 0005 Hub อ่านแค่หัวซอง type ที่ต้องเขียนซ้ำใน Go จึงมีแค่หัวซอง ส่วนเนื้อในแชร์กันเฉพาะระหว่าง Runtime กับแอป Hub เป็น service ที่ต้องรันนานและถือ WebSocket ไว้จำนวนมาก Go ทำงานแบบนี้ได้เสถียร ออกมาเป็น binary ไฟล์เดียว และไม่ผูกกับผู้ให้บริการเจ้าไหน ข้อความทุกชิ้นวิ่งอยู่ใน Workspace เดียว เราจึงขยายระบบได้ด้วยการแบ่ง Workspace ไปไว้คนละเครื่อง โดยไม่ต้องมี pub/sub v0.1 รันบน VPS เครื่องเดียว ใช้ docker compose รัน Hub, Postgres และ Caddy (ออก TLS ให้เอง) และสำรอง Postgres ขึ้น object storage

## Considered Options

- **Cloudflare Durable Objects**: แบบ 1 Workspace = 1 object เข้ากับระบบได้พอดี แต่ผูกกับ Cloudflare
- **Bun/TypeScript**: ใช้ภาษาเดียวทั้งระบบ แต่ข้อดีนี้มีน้อยมากในเมื่อ Hub เห็นแค่หัวซอง
