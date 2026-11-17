## ADDED Requirements

### Requirement: Turn ที่เงียบเกินห้านาทีมี event turn.stalled
Task log SHALL มี event kind ใหม่ `turn.stalled` ที่ `body` มี `{ since }` คือเวลาของกิจกรรมล่าสุดก่อนเงียบ supervisor SHALL เขียน `turn.stalled` เมื่อ Turn ที่ยังไม่จบไม่มี event ใหม่และไม่มี output ของคำสั่งที่กำลังรันติดต่อกันห้านาที ช่วงที่ Approval รอคนตอบ SHALL ไม่ถูกนับ supervisor SHALL เขียน `turn.stalled` ไม่เกินหนึ่งครั้งต่อช่วงที่เงียบ และ SHALL เขียนได้อีกเมื่อมีกิจกรรมแล้วเงียบครบห้านาทีอีกรอบ event ถัดไปของ Turn SHALL ถือว่า Turn ไม่ค้างแล้วโดยไม่มี event แยก `turn.stalled` เป็น event แบบต่อท้ายอย่างเดียวและ MUST NOT ถูกแก้หรือลบ

#### Scenario: Provider ไม่ตอบ
- **WHEN** Turn หนึ่งส่งคำขอถึง Provider แล้วไม่ได้คำตอบเป็นเวลาห้านาที
- **THEN** Task log มี `turn.stalled` หนึ่ง event ต่อท้ายใน Turn นั้น

#### Scenario: คำสั่งยังพิมพ์ output
- **WHEN** คำสั่งหนึ่งรันแปดนาทีโดยพิมพ์ output ทุกสิบวินาที
- **THEN** Task log ไม่มี `turn.stalled` ใน Turn นั้น

#### Scenario: รอ Approval
- **WHEN** Agent ขอ Approval และไม่มีใครตอบเป็นเวลาสิบนาที
- **THEN** Task log ไม่มี `turn.stalled` ระหว่างที่ Approval รออยู่

#### Scenario: ค้างแล้วเดินต่อแล้วค้างอีก
- **WHEN** Turn เงียบห้านาที แล้วได้คำตอบจาก Provider แล้วเงียบอีกห้านาที
- **THEN** Task log มี `turn.stalled` สอง event คั่นด้วย `llm.message`

### Requirement: Turn ที่ค้างส่ง push ถึงคนที่เริ่ม
เมื่อ supervisor เขียน `turn.stalled` Runtime SHALL ส่ง push หนึ่งครั้งถึง Controller ที่ลงทะเบียนไว้ของ Member ที่เริ่ม Turn นั้นเท่านั้น เนื้อหา push SHALL เป็นข้อความกลางๆ ในภาษาที่ลงทะเบียนไว้ ไม่มีชื่อ Agent คำสั่ง หรือเนื้อหา Task และ `data` SHALL มีเฉพาะรหัสที่ใช้เปิด Task นั้น

#### Scenario: ค้างตอนแอปปิด
- **WHEN** Member สั่งงานแล้วปิดแอป และ Turn เงียบครบห้านาที
- **THEN** เครื่องของ Member ได้ push หนึ่งครั้ง และกดแล้วเปิด Task นั้น

#### Scenario: Member อื่น
- **WHEN** Turn ที่ Member คนหนึ่งเริ่มค้าง
- **THEN** Member คนอื่นไม่ได้ push ของ Turn นั้น
