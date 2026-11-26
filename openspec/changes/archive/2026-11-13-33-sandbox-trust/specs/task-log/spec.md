## MODIFIED Requirements

### Requirement: Task เป็น event log ที่ต่อท้ายอย่างเดียว
supervisor SHALL เก็บทุก Task ของ Agent เป็นลำดับของ event ในฐานข้อมูลของ Agent ตัวนั้น และ SHALL เป็นผู้เดียวที่เขียน event ลงฐานข้อมูล worker SHALL ส่ง event ให้ supervisor ทาง IPC และ MUST NOT เขียนฐานข้อมูลเอง แต่ละ event SHALL มีเลขลำดับภายใน Task ที่เริ่มที่ 1 และเพิ่มทีละ 1 event MUST NOT ถูกแก้หรือลบ event ของ v0.1 SHALL มีข้อความของ Member พร้อมชื่อ Member, การเริ่ม Turn, ผลจาก LLM ตามที่ได้รับทุกตัวอักษรรวมถึง thinking block, การเรียก tool กับผลของ tool และการจบ Turn พร้อมเหตุผล ฐานข้อมูล SHALL อยู่นอกโฟลเดอร์ที่ sandbox เปิดให้ Agent เขียน และไม่อยู่ใน Workdir (ADR 0018, 0032) สำหรับ Agent ที่มีฐานข้อมูลอยู่ก่อนการย้ายเจ้าของผู้เขียน supervisor SHALL ทำให้ประวัติเดิมต่อเนื่องได้โดย Owner ไม่ต้องทำอะไร

#### Scenario: Turn ที่จบปกติ
- **WHEN** Owner ส่งข้อความแล้ว LLM ตอบ
- **THEN** log มีข้อความของ Owner, การเริ่ม Turn, ผลจาก LLM และการจบ Turn ตามลำดับ เลขต่อกันไม่ขาด

#### Scenario: เริ่มใหม่
- **WHEN** worker เริ่มใหม่
- **THEN** event เดิมทุกตัวยังอยู่ด้วยเลขเดิม

#### Scenario: worker ตายกลาง Turn
- **WHEN** worker ตายหลัง supervisor บันทึก event ของ Turn แล้ว
- **THEN** event ที่บันทึกแล้วยังอยู่ใน log หลังเปิด worker ใหม่
