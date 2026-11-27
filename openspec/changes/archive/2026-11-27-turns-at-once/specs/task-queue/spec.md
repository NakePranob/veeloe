## MODIFIED Requirements

### Requirement: ส่งข้อความเข้าคิวขณะ Agent ไม่ว่าง
Controller SHALL ยอมให้ผู้ใช้ส่งข้อความใน Task ขณะ Agent กำลังทำ Turn ข้อความที่เข้า Task ที่ Turn ของ Task นั้นยังไม่จบ Runtime SHALL เก็บไว้ในคิวของ Task นั้นและเริ่มเป็น Turn ถัดไปของ Task นั้นหลัง Turn ปัจจุบันจบ ข้อความที่เข้า Task อื่นที่ไม่มี Turn ค้างอยู่ SHALL เริ่มเป็น Turn ทันที ไม่รอ Turn ของ Task อื่น (ADR 0080) Controller MUST แสดงว่าข้อความจะรอ Turn ปัจจุบันของ Task นั้น

#### Scenario: ส่งขณะ Turn กำลังทำ
- **WHEN** Turn ของ Task กำลังทำ และผู้ใช้พิมพ์ข้อความใหม่ใน Task เดียวกันแล้วกด Send
- **THEN** ข้อความถูกส่งและรอในคิวของ Task นั้น ไม่ถูกปฏิเสธเพราะ Agent ไม่ว่าง

#### Scenario: ข้อความในคิวถูกประมวลผลต่อ
- **WHEN** Turn ปัจจุบันของ Task จบ
- **THEN** ข้อความในคิวของ Task นั้นเริ่มเป็น Turn ถัดไปตามลำดับ

#### Scenario: Task อื่นเริ่มทันที
- **WHEN** Turn ของ Task A กำลังทำ และผู้ใช้ส่งข้อความเข้า Task B หรือเปิด Task ใหม่
- **THEN** Turn ของ Task B เริ่มทันทีพร้อมกับ Turn ของ Task A

#### Scenario: ยังไม่ได้พิมพ์ข้อความ
- **WHEN** Agent ไม่ว่างและช่องข้อความว่าง
- **THEN** ปุ่ม Stop ยังแสดงเหมือนเดิม

#### Scenario: Stop ขณะมีข้อความรอ
- **WHEN** มีข้อความรออยู่ในคิวของ Task และผู้ใช้กด Stop
- **THEN** Turn ที่กำลังทำหยุด และข้อความในคิวยังเริ่มเป็น Turn ถัดไปตามลำดับ

#### Scenario: ส่งซ้ำ
- **WHEN** ข้อความเดิมถูกส่งอีกครั้งเพราะ Controller ต่อใหม่
- **THEN** log ไม่มีข้อความนั้นซ้ำและไม่มี Turn ใหม่
