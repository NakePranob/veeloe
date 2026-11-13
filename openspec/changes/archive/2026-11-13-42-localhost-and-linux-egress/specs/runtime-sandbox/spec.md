## MODIFIED Requirements

### Requirement: Agent ออกเน็ตได้แค่โดเมนใน Egress
ภายใต้ sandbox การเชื่อมต่อเครือข่ายทุกทางของ worker และโปรเซสลูก SHALL ผ่านตัวกรองของ supervisor ซึ่งยอมเฉพาะโดเมนใน Egress ของ Agent worker MUST NOT ต่อที่อยู่บนเครื่องเองได้ รวมถึง port ของโปรแกรมอื่นที่ฟังอยู่ที่ `127.0.0.1` ยกเว้น port ในช่วงของ Agent ตัวเอง คำขอไป LLM SHALL ไม่ต้องอยู่ใน Egress เพราะวิ่งผ่าน IPC บน macOS ทางออกคือ TCP ไป proxy ที่ supervisor เปิด ส่วน Linux SHALL ส่งผ่าน Unix socket ของ proxy ที่ bind เข้า namespace (ADR 0029, 0042, 0069)

#### Scenario: โดเมนใน Egress
- **WHEN** Egress มี `registry.npmjs.org` แล้ว Agent รันคำสั่งที่ดาวน์โหลดจากโดเมนนั้น
- **THEN** ดาวน์โหลดได้ทั้งบน macOS และ Linux

#### Scenario: โดเมนนอก Egress
- **WHEN** Agent รัน `curl https://example.com` ขณะที่ Egress ไม่มีโดเมนนั้น
- **THEN** การเชื่อมต่อถูกปฏิเสธ และคำสั่งได้ error

#### Scenario: ที่อยู่บนเครื่อง
- **WHEN** Agent ต่อ `127.0.0.1` ที่ port ของโปรแกรมอื่นซึ่งไม่ได้อยู่ในช่วงของ Agent
- **THEN** การเชื่อมต่อถูกปฏิเสธ

#### Scenario: คุยกับ LLM ขณะ Egress ว่าง
- **WHEN** Egress ว่างแล้ว Owner ส่งข้อความหา Agent
- **THEN** Agent ยังตอบได้ตามปกติ

## ADDED Requirements

### Requirement: Agent รัน service ของตัวเองบน localhost
Agent SHALL มี localhost ของตัวเองไว้รัน dev server, Postgres, Redis และ headless browser โดยไม่ชนกับ Agent อื่น บน Linux worker SHALL อยู่ใน network namespace ที่มี loopback ของตัวเอง (bwrap เปิด `lo` ให้) และคำสั่งลูกทั้งหมด SHALL ใช้ namespace เดียวกัน service ที่คำสั่งเริ่ม SHALL อยู่ข้าม Turn ตราบที่ worker ยังอยู่ บน macOS supervisor SHALL จองช่วง port คงที่ต่อ Agent (10 port) เก็บไว้นอกโฟลเดอร์ที่ Agent เขียนได้ รอด restart และ MUST NOT ให้สอง Agent ใช้ช่วงเดียวกัน profile SHALL เปิด network เข้าและออกเฉพาะ port ในช่วงนั้น บวก port ของ proxy worker SHALL ได้ `PORT` เป็น port แรกและ `VEELOE_PORTS` เป็นรายชื่อ port ทั้งช่วง

#### Scenario: dev server ของตัวเอง
- **WHEN** Agent รัน dev server ที่ผูกกับ `PORT` แล้ว `curl http://127.0.0.1:$PORT`
- **THEN** ต่อได้ทั้ง macOS และ Linux

#### Scenario: service สองตัวบน Linux
- **WHEN** Agent สองตัวรัน service ที่ใช้เลข port เดียวกัน
- **THEN** ทั้งคู่ทำงานได้ เพราะคนละ network namespace

#### Scenario: port คงที่หลัง restart
- **WHEN** worker ถูกเปิดใหม่
- **THEN** Agent ได้ช่วง port เดิมและ service ที่เคยผูกไว้ใช้ค่าเดิม

#### Scenario: service ของเจ้าของเครื่อง
- **WHEN** Agent ต่อ service ที่เจ้าของเครื่องเปิดไว้นอกช่วง port ของ Agent
- **THEN** การเชื่อมต่อถูกปฏิเสธ
