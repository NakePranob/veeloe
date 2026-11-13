## Why

issue #42 (ชิ้นที่ 3 ของ #32): Agent ยังรัน dev server กับ service ของตัวเองไม่ได้บน macOS เพราะไม่ได้รับช่วง port และบน Linux ออกเน็ตไม่ได้เลย เพราะ `--unshare-all` ให้ network namespace ว่างที่ไม่มีทางออก งาน dev จึงทำได้เฉพาะ macOS และเฉพาะเครื่องที่ไม่ได้กัน port

## What Changes

- macOS: supervisor จองช่วง port คงที่ต่อ Agent (10 port) เก็บไว้ใน `<VEELOE_HOME>/runtime/ports.json` แล้วส่ง `PORT` และ `VEELOE_PORTS` ให้ worker profile เปิด network-inbound/outbound เฉพาะ port ในช่วงนั้น บวก port ของ proxy
- Linux: proxy ของ supervisor เปิด Unix socket เพิ่มจาก TCP; `bwrap` bind socket นั้นเข้า namespace ที่ path คงที่; worker เปิด TCP bridge บน `127.0.0.1` ภายใน namespace แล้วส่งต่อ Unix socket และตั้ง `HTTP_PROXY`/`HTTPS_PROXY` ให้คำสั่ง ไม่ใช้ `socat`
- Linux: loopback ของ namespace ใช้ได้ (bwrap เปิด `lo` ให้แล้ว) service ที่คำสั่งเริ่มจึงอยู่ข้าม Turn ได้ตราบที่ worker ยังอยู่ และสอง Agent ใช้เลข port เดียวกันได้เพราะคนละ namespace
- e2e เคส Egress เอา skip macOS-only ออก และรันบน Linux

## Capabilities

### New Capabilities

ไม่มี

### Modified Capabilities

- `runtime-sandbox`: localhost ต่อ Agent, ช่วง port บน macOS, ทางออกเน็ตบน Linux ผ่าน proxy

## Impact

- `runtime-core`: `Policy` มีช่วง port และที่อยู่ของ proxy socket; profile ของ macOS และ argument ของ `bwrap`
- `runtime-supervisor`: จองและเก็บช่วง port, เปิด Unix socket ของ proxy, ส่ง path/port ให้ worker, toolchain check ใช้ policy เดียวกัน
- `runtime-worker`: bridge TCP loopback → Unix socket บน Linux
- e2e: เคส Egress รันทั้งสองระบบ
- ผู้ใช้: Agent รัน dev server/Postgres/Redis และติดตั้ง package บน Linux ได้
