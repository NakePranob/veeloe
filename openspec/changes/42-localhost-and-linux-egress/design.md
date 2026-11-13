## Context

- `Sandbox::wrap` สร้าง profile ของ macOS และ argv ของ `bwrap` จาก `Policy` (`folder`, `workdir`, `tmp`, `bin`, `proxy`)
- macOS: `(deny network*)` แล้วเปิด `network-outbound` ไป `localhost:<proxy port>` เท่านั้น; ไม่มี inbound เลย คำสั่งจึง bind dev server ไม่ได้
- Linux: `bwrap --unshare-all` ให้ namespace ที่ `lo` ขึ้นแล้ว (ทดลองใน Ubuntu 24.04: `lo` เป็น UP และ `python3 -m http.server` ต่อได้) แต่ไม่มี route ออกนอกและ proxy ไม่ได้ผูกเข้าไป
- `egress::Proxy` ฟัง TCP `127.0.0.1:0` และตรวจ Egress/โดเมน/IP/SNI อยู่แล้ว
- supervisor เปิด worker ต่อ Agent หนึ่ง process; คำสั่งลูกทั้งหมดอยู่ใน namespace/profile เดียวกัน

## Goals / Non-Goals

**Goals:**
- macOS: ช่วง port คงที่ต่อ Agent + `PORT` + กฎ network เฉพาะช่วง
- Linux: ทางออกเน็ตผ่าน proxy เดียวกัน โดยไม่มีทางออกตรง
- test ทั้งสองระบบ และ e2e Egress กลับมารันบน Linux

**Non-Goals:**
- proxy ต่อ Turn, Egress ต่อ Agent
- git broker, ทรัพยากร, AppArmor, Chromium

## Decisions

**ช่วง port คงที่ต่อ Agent เก็บนอก sandbox:** supervisor จอง 10 port จากช่วง 20000–60000 (step 10) ครั้งแรกที่เปิด worker แล้วเก็บใน `<VEELOE_HOME>/runtime/ports.json` (runtime เป็นเจ้าของ ไฟล์ไม่อยู่ในโฟลเดอร์ที่ Agent เขียนได้) เลือกช่วงที่ยังไม่ถูกจองและไม่ทับ port ของ proxy; `PORT` คือ port แรกและ `VEELOE_PORTS` เป็นรายการคั่นด้วย comma ช่วงต้องรอด restart และสอง Agent ต้องไม่ทับกัน

**macOS เปิด network เฉพาะช่วง:** profile เปิด `network-inbound` และ `network-outbound` แบบ `(local ip "localhost:PORT")` / `(remote ip "localhost:PORT")` ทีละ port ในช่วง บวก outbound ไป port ของ proxy ข้อจำกัดของ Seatbelt ที่ `localhost` อาจจับ address อื่นของเครื่องด้วยเป็นข้อจำกัดที่บันทึกไว้แล้ว; port นอกช่วงยังถูกปฏิเสธ

**Linux ใช้ Unix socket ของ proxy + bridge ใน worker:** proxy เปิด Unix listener ที่ `<VEELOE_HOME>/runtime/egress.sock`; `bwrap` bind ไฟล์นั้นเข้า namespace ที่ `/run/veeloe/egress.sock`; worker เปิด TCP listener บน `127.0.0.1:<port>` ใน namespace แล้ว `copy_bidirectional` ไป Unix socket คำสั่งได้ `HTTP_PROXY`/`HTTPS_PROXY` ชี้ bridge นี้ ไม่ใช้ `socat` และไม่เปิดทางออกอื่น

**loopback ของ Linux:** bwrap เปิด `lo` ให้อยู่แล้ว จึงไม่ต้องรัน `ip link set lo up`; service ที่คำสั่งเริ่มอยู่ใน namespace ของ worker และอยู่ข้าม Turn ตราบที่ worker ยังอยู่

**Transport เดียวกัน ตรวจเดียวกัน:** proxy ไม่รู้จัก transport — TCP กับ Unix ใช้ตัวจัดการ request/ตรวจ Egress/SNI ชุดเดียวกัน

## Risks / Trade-offs

- [Seatbelt `localhost` อาจกว้างกว่า loopback] → จำกัดด้วยช่วง port ต่อ Agent และบันทึกข้อจำกัด
- [Unix socket path ต้องมี parent dir ใน namespace] → bind ที่ path คงที่ใต้ `/run/veeloe` และสร้าง dir ด้วย `--dir`
- [bridge port อาจชนกับ service ที่ Agent เปิด] → เลือก port จากช่วงของ Agent และส่งให้ worker ทาง argument/env; ถ้า bind ไม่ได้ worker รายงานและไม่พร้อมรับงาน
- [Linux ไม่มี Linux เครื่องนี้ให้ทดลอง] → ใช้ Docker + Ubuntu 24.04 ทดลอง bwrap/loopback/Unix socket และให้ CI รัน test จริง

## Migration Plan

Agent ที่มีอยู่ได้ช่วง port ใหม่ตอนเปิด worker ครั้งแรกหลังอัปเดต และเก็บไว้ใช้ต่อ ไม่มีข้อมูลอื่นต้องย้าย
