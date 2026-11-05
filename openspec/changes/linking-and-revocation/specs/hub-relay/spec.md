## MODIFIED Requirements

### Requirement: client แต่ละแบบใช้เส้นทางของตัวเอง
Hub SHALL รับ `to` จาก Controller เท่านั้น และรับ `recipients` จาก Machine และ SHALL รับ `recipients` จาก Controller เฉพาะเมื่อรายชื่อมีแค่ Member เจ้าของ Controller นั้น เพื่อส่งถึงเครื่องอื่นของตัวเอง กรณีอื่น SHALL ตอบด้วย code `hub.route_not_allowed` เพราะมีแต่ Runtime ที่เลือกผู้รับจาก Grant

#### Scenario: Controller ส่งถึง Member
- **WHEN** Controller ส่งซองที่มีรายชื่อผู้รับซึ่งมี Member อื่นอยู่
- **THEN** Hub ไม่ส่งต่อ และตอบด้วย `hub.route_not_allowed`

#### Scenario: Controller ส่งถึงเครื่องอื่นของตัวเอง
- **WHEN** Controller ส่งซองที่รายชื่อผู้รับมีแค่ Member ของตัวเอง
- **THEN** Hub ส่งต่อให้ Controller ทุกเครื่องของ Member นั้นที่ต่ออยู่ ยกเว้นสายที่ส่งมา

#### Scenario: Machine ส่งถึง Machine
- **WHEN** Machine ส่งซองที่มี `to`
- **THEN** Hub ไม่ส่งต่อ และตอบด้วย `hub.route_not_allowed`
