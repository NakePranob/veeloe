# สิ่งที่ต้องลองด้วยมือ

ไฟล์นี้จดสิ่งที่ agent ลองเองไม่ได้ เพราะ Simulator ไม่มีกล้องและไม่บังคับ Face ID ส่วนการวางลิงก์, Hub จริงบน Postgres และ `veeloe pair` จริง agent ลองแล้วบน iOS Simulator และ Chromium

repo นี้เป็น public เมื่อรายงานผล ให้ระบุแค่เครื่อง รุ่น OS ข้อที่ลอง และผลที่ได้ และอย่าใส่ลิงก์ Pairing เพราะมีรหัสลับ

## เตรียม Hub ให้ iPhone ต่อถึง

`<ip>` คือ IP ของ Mac ในวงเดียวกับ iPhone ใช้ port นี้เพื่อไม่ชนกับ Postgres ตัวอื่นบนเครื่อง และ `HUB_PUBLIC_URL` ต้องตรงกับ URL ที่ใช้ใน `veeloe pair` ทุกตัวอักษร เพราะอยู่ในลายเซ็น รันจาก root ของ repo

```bash
docker run -d --rm --name veeloe-hub-pg -p 55433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hub postgres:16-alpine
```

```bash
migrate -path hub/migrations -database 'postgres://postgres:postgres@localhost:55433/hub?sslmode=disable' up
```

```bash
cd hub && PORT=8090 DB_DSN='postgres://postgres:postgres@localhost:55433/hub?sslmode=disable' HUB_PUBLIC_URL='ws://<ip>:8090' go run ./cmd/api
```

ติดตั้งแอปลง iPhone ตาม `openspec/changes/controller-device-key/manual-checks.md` ข้อ 1 แล้วรัน Runtime ในอีก terminal เมื่อลองเสร็จให้รัน `docker stop veeloe-hub-pg`

```bash
VEELOE_HOME=/tmp/veeloe-try bun packages/runtime/src/main.ts pair --hub ws://<ip>:8090
```

## 1. iPhone จริง: สแกนและ Face ID

ลองตามลำดับนี้ ข้อ 1.5 ต้องทำ Pairing สำเร็จก่อน

| ข้อ | ทำอะไร | ควรเห็น |
|---|---|---|
| 1.1 | ในแอปกด เพิ่ม Machine แล้วกดสแกน QR | iOS ถามสิทธิ์กล้องครั้งเดียว แล้วเห็นภาพจากกล้อง |
| 1.2 | สแกน QR จาก terminal พื้นมืด และลองซ้ำบนธีมพื้นสว่าง | อ่านได้ทั้งสองแบบ แล้วเห็นหน้ายืนยันพร้อม Hub ที่ตรงกับ `<ip>` |
| 1.3 | สแกน QR ด้วยแอปกล้องของ iPhone แทน | iOS ถามว่าจะเปิดใน Veeloe แล้วเข้าหน้ายืนยันเดียวกัน |
| 1.4 | ในหน้ายืนยันกด ผูก แล้วยกเลิก Face ID | อยู่หน้าเดิม แอปไม่ล็อก Hub ไม่ได้รับ `POST /pairings` และกด ผูก ใหม่ได้ |
| 1.5 | กด ผูก แล้วยืนยัน Face ID | เห็นชื่อ Mac บนหน้าแรก และ terminal บอกว่า paired ปิดแอปแล้วเปิดใหม่ก็ยังอยู่ |
| 1.6 | รัน `veeloe` ด้วย `VEELOE_HOME` เดิมโดยไม่ระบุ Hub | terminal บอก connected to hub |
| 1.7 | รัน `veeloe pair` ซ้ำ | คำสั่งปฏิเสธและบอกให้รัน `veeloe unpair` |
| 1.8 | ปฏิเสธสิทธิ์กล้องใน Settings แล้วกดสแกน QR | แอปบอกให้วางลิงก์แทน และยังวางได้ |

## 2. เว็บบนเครื่องจริง

Chromium ของ agent ใช้ passkey จำลอง และไม่ได้ลองกล้อง

| ข้อ | ทำอะไร | ควรเห็น |
|---|---|---|
| 2.1 | เปิด Controller บน Safari หรือ Chrome แล้ววางลิงก์จาก `veeloe pair` | ถาม passkey ก่อนผูก แล้วเห็น Machine บนหน้าแรก |
| 2.2 | ยกเลิก passkey ในหน้ายืนยัน | อยู่หน้าเดิม และไม่มีคำขอไป Hub |
| 2.3 | กดสแกน QR บนเครื่องที่มีกล้อง | ถามสิทธิ์กล้องแล้วอ่าน QR ได้ ถ้าเบราว์เซอร์ปฏิเสธ แอปต้องบอกให้วางลิงก์แทน |
