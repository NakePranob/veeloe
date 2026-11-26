# machine-egress Specification

## Purpose

กำหนด Egress ของ v0.1 ซึ่งเป็นรายชื่อโดเมนเดียวที่ใช้กับ Agent ทุกตัวบน Machine เก็บที่ไหน Owner แก้อย่างไร และแอปบอกขอบเขตของรายชื่อนี้อย่างไร จนกว่าจะแยกเป็นของแต่ละ Agent ตาม ADR 0029

## Requirements

### Requirement: Machine มี Egress รายชื่อเดียวที่เริ่มจากว่าง
supervisor SHALL เก็บ Egress ของ Machine เป็นรายชื่อโดเมนในไฟล์ของตัวเอง ให้อยู่รอดข้ามการเริ่มใหม่ Machine ที่ยังไม่เคยตั้ง SHALL มี Egress ว่าง ซึ่งแปลว่า Agent ออกเน็ตไม่ได้เลย Egress SHALL ใช้กับ Agent ทุกตัวบน Machine เท่ากัน แต่ละรายการ SHALL เป็นชื่อโดเมน เช่น `github.com` หรือ wildcard ระดับเดียวด้านหน้า เช่น `*.npmjs.org` และ MUST NOT เป็นที่อยู่ IP, `localhost`, URL ที่มี scheme หรือ path

#### Scenario: Machine ใหม่
- **WHEN** Owner ทำ Pairing กับ Machine ที่ไม่เคยตั้ง Egress
- **THEN** Egress ว่าง และคำสั่งที่ออกเน็ตของ Agent ทุกตัวถูกปฏิเสธ

#### Scenario: wildcard
- **WHEN** Egress มี `*.npmjs.org`
- **THEN** Agent ต่อ `registry.npmjs.org` ได้

### Requirement: Owner แก้ Egress จาก Controller
Controller SHALL ส่งรายชื่อ Egress ทั้งชุดใหม่ในคำสั่งที่เซ็นด้วยกุญแจของ Owner และ SHALL ขอยืนยันตัวใหม่ก่อนเซ็นทุกครั้ง supervisor SHALL ตรวจลายเซ็นและกุญแจที่ไว้ใจ ตรวจทุกรายการ แล้วบันทึกทั้งชุดหรือไม่บันทึกเลย รายชื่อใหม่ SHALL มีผลกับการเชื่อมต่อครั้งถัดไปของ Agent ทุกตัวโดยไม่ต้องเริ่ม Runtime ใหม่ supervisor SHALL ตอบด้วยรายชื่อ Agent ที่มี Egress ปัจจุบัน และรายชื่อ Agent กับ Provider ที่ Controller ขอ SHALL มี Egress ปัจจุบันด้วย

#### Scenario: เพิ่มโดเมน
- **WHEN** Owner เพิ่ม `pypi.org` ในหน้า Machine แล้วยืนยันตัว
- **THEN** supervisor บันทึก Controller เห็น `pypi.org` ใน Egress และ Agent ทุกตัวต่อ `pypi.org` ได้ทันที

#### Scenario: เอาโดเมนออก
- **WHEN** Owner เอา `pypi.org` ออก
- **THEN** การเชื่อมต่อใหม่ไป `pypi.org` ของ Agent ทุกตัวถูกปฏิเสธ

#### Scenario: รายการผิดรูปแบบ
- **WHEN** คำสั่งมีรายการเช่น `https://pypi.org/simple`, `10.0.0.1` หรือ `localhost`
- **THEN** supervisor ตอบ error code `egress.invalid_domain` และ Egress เดิมไม่เปลี่ยน

#### Scenario: คนที่ไม่ได้รับความไว้ใจ
- **WHEN** คำสั่งแก้ Egress เซ็นด้วยกุญแจที่ไม่อยู่ใน trust
- **THEN** supervisor ทิ้งคำสั่งและไม่ตอบ

### Requirement: แอปบอกว่า Egress ใช้กับ Agent ทุกตัวบนเครื่อง
หน้า Machine ของ Controller SHALL แสดง Egress ของ Machine นั้น และ SHALL บอกให้ชัดว่าทุกโดเมนในรายชื่อเปิดให้ Agent ทุกตัวบนเครื่องนั้นออกไปได้ พร้อมชื่อ Agent ที่มี และข้อมูลยังส่งออกไปโดเมนในรายชื่อได้ (ADR 0008) เมื่อ Egress ว่าง แอป SHALL บอกว่า Agent ออกเน็ตไม่ได้ เมื่อ Machine ออฟไลน์ แอป SHALL ไม่ส่งคำสั่งแก้ และบอกว่าต้องรอ Machine กลับมา

#### Scenario: ดู Egress
- **WHEN** Owner เปิดหน้า Machine ที่มี Agent สองตัว
- **THEN** เห็นรายชื่อโดเมนพร้อมข้อความว่าใช้กับ Agent ทั้งสองตัวโดยระบุชื่อ

#### Scenario: Machine ออฟไลน์
- **WHEN** Owner กดเพิ่มโดเมนขณะ Machine ออฟไลน์
- **THEN** แอปบอกว่า Machine ต้องออนไลน์ก่อน และไม่ขอยืนยันตัว

### Requirement: เริ่มเครื่องใหม่แล้ว Egress ว่าง
`veeloe unpair` SHALL ล้าง Egress ไปพร้อมกุญแจที่ไว้ใจและรายชื่อ Agent เพื่อให้ Workspace ที่ Pairing ครั้งถัดไปเริ่มจาก Egress ว่าง (ADR 0035)

#### Scenario: Pairing ใหม่หลัง unpair
- **WHEN** เจ้าของรัน `veeloe unpair` แล้วทำ Pairing กับ Controller ใหม่
- **THEN** Controller ใหม่เห็น Egress ว่าง

### Requirement: Controller แก้ Egress ต่อ Agent ได้
Controller SHALL ให้ Owner เลือก Agent ในหน้า Machines → Egress และเพิ่มหรือลบโดเมนของ Agent ตัวนั้น โดยส่ง `egress.set` ที่ระบุ Agent และ SHALL แสดงรายการที่ Machine เซ็นกลับมาของ Agent นั้น ตัวเลือกที่แก้ทุก Agent พร้อมกัน SHALL ยังใช้ได้และ MUST NOT ทำให้รายการของ Agent แต่ละตัวหาย Egress ของ Agent SHALL ถูกเก็บในเครื่องและยังอยู่หลังปิดเปิดแอป

#### Scenario: แก้ของ Agent หนึ่ง
- **WHEN** Owner เลือก Agent A แล้วเพิ่มโดเมน
- **THEN** คำขอระบุ Agent A และรายการของ Agent อื่นไม่เปลี่ยน

#### Scenario: แก้ทุก Agent
- **WHEN** Owner เลือก "ทุก Agent" แล้วเพิ่มโดเมน
- **THEN** คำขอไม่ระบุ Agent และทุก Agent ได้โดเมนนั้น

#### Scenario: ปิดเปิดแอป
- **WHEN** Owner ปิดและเปิดแอปใหม่
- **THEN** Egress ของแต่ละ Agent ยังแสดงตามที่ Machine เซ็นกลับมาล่าสุด
