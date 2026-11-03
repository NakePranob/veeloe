# hub-relay Specification

## Purpose

Hub ส่งต่อซองระหว่าง Controller กับ Runtime จากหัวซองอย่างเดียวอย่างไร โดยไม่เก็บเนื้อใน และไม่ต้องเป็นคนตัดสินว่าเนื้อในเชื่อได้ไหม

## Requirements

### Requirement: Hub ส่งต่อ frame โดยไม่เปลี่ยน
Hub SHALL ส่งต่อซองเป็น byte ตามที่ได้รับ SHALL ตัดสินเส้นทางจากหัวซองเท่านั้น SHALL NOT ตรวจลายเซ็นของซองหรือ parse ส่วนที่เซ็น และ SHALL ส่งต่อชนิดข้อความและ field ที่ไม่รู้จัก

#### Scenario: ชนิดข้อความที่ไม่รู้จัก
- **WHEN** client ที่พิสูจน์ตัวตนแล้วส่งซองรูปแบบถูกต้องซึ่ง Hub ไม่เคยเห็นชนิดข้อความนั้น
- **THEN** Hub ส่งต่อซองนั้น

#### Scenario: byte ไม่เปลี่ยน
- **WHEN** ซองที่มี field ไม่รู้จักในหัวซองและเว้นวรรคแปลกๆ ถูกส่งต่อ
- **THEN** ผู้รับได้ทุก byte ตามที่ผู้ส่งส่ง และลายเซ็นตรวจผ่าน

### Requirement: Hub ไม่เก็บเนื้อหา
Hub SHALL NOT เขียนส่วนที่เซ็นของซองลง database หรือ log และ SHALL NOT มีคิวเก็บซองไว้ส่งทีหลัง

#### Scenario: ไม่มีผู้รับ
- **WHEN** ซองไม่มีผู้รับที่ต่ออยู่
- **THEN** ไม่มีอะไรของซองเหลือบน Hub หลังจัดการเสร็จ

### Requirement: ผู้ส่งแอบอ้างกุญแจอื่นไม่ได้
Hub SHALL ทิ้งซองที่ `from` ต่างจากกุญแจที่สายนั้นใช้พิสูจน์ตัวตน และ SHALL ตอบผู้ส่งด้วย error frame

#### Scenario: ปลอมกุญแจผู้ส่ง
- **WHEN** client ส่งซองที่ระบุกุญแจอื่นใน `from`
- **THEN** Hub ไม่ส่งต่อ และตอบด้วย code `hub.sender_mismatch`

#### Scenario: ซ่อนกุญแจจริงไว้ใน field ที่ตัวพิมพ์ต่างกัน
- **WHEN** client ส่งซองที่ `from` เป็นกุญแจอื่น และมี field `FROM` เป็นกุญแจของตัวเอง
- **THEN** Hub อ่านเฉพาะ `from` ไม่ส่งต่อ และตอบด้วย code `hub.sender_mismatch`

### Requirement: ส่งต่อได้เฉพาะใน Workspace ของผู้ส่ง
Hub SHALL ส่งซองให้เฉพาะสายที่อยู่ใน Workspace เดียวกับสายที่ส่งมา ไม่ว่าหัวซองจะระบุอะไร

#### Scenario: Machine ใน Workspace อื่น
- **WHEN** Controller ส่งซองที่ `to` ชี้ Machine ใน Workspace อื่น
- **THEN** Hub ไม่ส่งต่อ และตอบเหมือนกรณีไม่รู้จัก Machine นั้น

#### Scenario: Member ใน Workspace อื่น
- **WHEN** รายชื่อผู้รับของ Machine มี Member ของ Workspace อื่น
- **THEN** Controller ของ Member นั้นไม่ได้รับอะไร

### Requirement: ปลายทางไปถึง Machine เดียว
ซองของ Controller ที่ `to` ชี้ Machine SHALL ถูกส่งถึงสายของ Machine นั้น เมื่อ Machine ไม่ได้ต่ออยู่หรือไม่รู้จัก Hub SHALL ตอบผู้ส่งทันทีด้วย error frame ที่มี code `hub.machine_offline` และ `sig` ของซองนั้น เพื่อให้ Controller เก็บซองไว้ในคิวขาออกและจับคู่คำตอบได้

#### Scenario: Machine ออนไลน์
- **WHEN** Controller ส่งซองถึง Machine ที่ต่ออยู่ใน Workspace เดียวกัน
- **THEN** Machine นั้นได้รับซอง

#### Scenario: Machine ออฟไลน์
- **WHEN** Controller ส่งซองถึง Machine ที่ไม่ได้ต่ออยู่
- **THEN** ผู้ส่งได้ `hub.machine_offline` พร้อม `sig` ของซองนั้น

### Requirement: รายชื่อผู้รับไปถึง Controller ที่ต่ออยู่ทุกเครื่องของ Member เหล่านั้น
ซองของ Machine ที่มี `recipients` SHALL ถูกส่งถึง Controller ที่ต่ออยู่ทุกเครื่องของ Member แต่ละคน Member ที่ไม่มี Controller ต่ออยู่ SHALL NOT ทำให้เกิด error เพราะ Controller จะขอ event ย้อนหลังเอง

#### Scenario: Member มี Controller สองเครื่อง
- **WHEN** Machine ระบุ Member ที่มี Controller ต่ออยู่สองเครื่อง
- **THEN** ทั้งสองเครื่องได้รับซอง

#### Scenario: Member ไม่ได้ต่ออยู่
- **WHEN** Machine ระบุ Member ที่ไม่มี Controller ต่ออยู่
- **THEN** ผู้รับคนอื่นยังได้รับ และ Machine ไม่ได้ error

### Requirement: client แต่ละแบบใช้เส้นทางของตัวเอง
Hub SHALL รับ `to` จาก Controller เท่านั้น และรับ `recipients` จาก Machine เท่านั้น และ SHALL ตอบกรณีอื่นด้วย code `hub.route_not_allowed` เพราะมีแต่ Runtime ที่เลือกผู้รับจาก Grant

#### Scenario: Controller ส่งถึง Member
- **WHEN** Controller ส่งซองที่มีรายชื่อผู้รับ
- **THEN** Hub ไม่ส่งต่อ และตอบด้วย `hub.route_not_allowed`

#### Scenario: Machine ส่งถึง Machine
- **WHEN** Machine ส่งซองที่มี `to`
- **THEN** Hub ไม่ส่งต่อ และตอบด้วย `hub.route_not_allowed`

### Requirement: รักษาลำดับต่อผู้ส่ง
ซองจากสายเดียวกัน SHALL ถึงผู้รับแต่ละรายตามลำดับที่ส่ง เพราะผู้รับปฏิเสธเลขลำดับที่ต่ำกว่าเลขที่รับไปแล้ว

#### Scenario: ส่งรัวจากผู้ส่งเดียว
- **WHEN** client ส่งซองจำนวนมากถึงผู้รับรายเดียวอย่างรวดเร็ว
- **THEN** ผู้รับได้ตามลำดับที่ส่ง

### Requirement: ผู้รับที่ช้าไม่ถ่วงคนอื่น
Hub SHALL จำกัดปริมาณข้อมูลที่ยังส่งไม่ออกต่อสาย เมื่อผู้รับเกินเพดาน Hub SHALL ปิดสายของผู้รับนั้น และบริการผู้ส่งต่อ

#### Scenario: ผู้รับหยุดอ่าน
- **WHEN** ผู้รับที่ต่ออยู่หยุดอ่านขณะที่ยังมีซองมาหา
- **THEN** Hub ปิดสายนั้น และซองถึงผู้รับอื่นยังไปได้

### Requirement: frame ที่ส่งต่อไม่ได้ไม่ทำให้สายปิด
หลังพิสูจน์ตัวตน Hub SHALL ข้าม frame ที่ไม่ใช่ซองรูปแบบถูกต้องและเป็นชนิดที่ไม่รู้จัก โดยไม่ปิดสาย ซองที่ระบุทั้งสองเส้นทางหรือไม่มีเลย SHALL ถูกทิ้งแบบเดียวกัน

#### Scenario: frame ที่ไม่รู้จัก
- **WHEN** client ที่พิสูจน์ตัวตนแล้วส่ง frame ที่ไม่ใช่ซอง
- **THEN** Hub ข้าม และสายยังเปิดอยู่

#### Scenario: ซองสองเส้นทาง
- **WHEN** client ที่พิสูจน์ตัวตนแล้วส่งซองที่ระบุทั้ง `to` และ `recipients`
- **THEN** Hub ไม่ส่งต่อ และสายยังเปิดอยู่

### Requirement: หัวซองของ Hub ตรงกับ Protocol ที่เผยแพร่
หัวซองและ handshake ของ Hub SHALL ถูกตรวจใน CI กับ JSON Schema และ test vector ที่ Protocol เผยแพร่

#### Scenario: หัวซองไม่ตรง schema
- **WHEN** หัวซองของ Hub ไม่มี field ตามที่ schema ที่เผยแพร่ระบุ
- **THEN** CI ล้มเหลว

#### Scenario: กฎเส้นทางจาก vector
- **WHEN** Hub อ่าน vector ของซองทุกตัวที่เผยแพร่
- **THEN** Hub ถือว่า vector ที่มีทั้งสองเส้นทางหรือไม่มีเลยส่งต่อไม่ได้

#### Scenario: รูปแบบ URL ของ Hub จาก vector
- **WHEN** Hub อ่าน vector ของ URL ทุกตัวที่เผยแพร่ ซึ่งรวม IPv6, โดเมนที่ไม่ใช่ ASCII และพอร์ตที่ขึ้นต้นด้วยศูนย์
- **THEN** Hub ได้รูปแบบเดียวกับที่ client เซ็น หรือปฏิเสธเหมือนกัน
