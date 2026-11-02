# hub-connection Specification

## Purpose

Machine หรือ Controller ต่อเข้า Hub ผ่าน WebSocket และพิสูจน์ตัวตนด้วยกุญแจอย่างเดียวอย่างไร และ Hub รู้ได้อย่างไรว่าตอนนี้สายไหนยังใช้งานอยู่

## Requirements

### Requirement: Challenge อยู่ใน frame แรก
ทุกการเชื่อมต่อ WebSocket ใหม่ Hub SHALL ส่ง challenge เป็น frame แรก ซึ่งมี nonce สุ่มใหม่อย่างน้อย 32 byte และเวอร์ชันของ Protocol การพิสูจน์ตัวตน SHALL อยู่ใน frame ของ WebSocket เท่านั้น ไม่อยู่ใน HTTP header เพื่อให้เบราว์เซอร์ทำแบบเดียวกันได้

#### Scenario: การเชื่อมต่อใหม่
- **WHEN** client เปิด WebSocket มาที่ Hub
- **THEN** frame แรกที่ได้คือ challenge ที่มี nonce ซึ่งไม่เคยเห็นในการเชื่อมต่อก่อนหน้า

### Requirement: เข้าได้เฉพาะกุญแจที่รู้จักพร้อมลายเซ็นถูกต้อง
client SHALL ตอบ challenge ด้วยกุญแจสาธารณะและลายเซ็น Ed25519 ที่ครอบข้อความบริบทคงที่ URL สาธารณะของ Hub และ nonce Hub SHALL รับการเชื่อมต่อเฉพาะเมื่อกุญแจเป็นของ Machine หรือ Controller ที่รู้จักและลายเซ็นถูกต้อง แล้ว SHALL ตอบ ready frame ที่ระบุ Machine นั้น หรือ Member ของ Controller นั้น ไม่อย่างนั้น Hub SHALL ปิดการเชื่อมต่อด้วย error การพิสูจน์ตัวตน

#### Scenario: กุญแจ Machine ที่รู้จัก
- **WHEN** Machine ที่ Hub รู้จักกุญแจเซ็น challenge ถูกต้อง
- **THEN** Hub ตอบ ready frame ที่ระบุ Machine นั้น

#### Scenario: กุญแจ Controller ที่รู้จัก
- **WHEN** Controller ที่ Hub รู้จักกุญแจเซ็น challenge ถูกต้อง
- **THEN** Hub ตอบ ready frame ที่ระบุ Member ของ Controller นั้น

#### Scenario: กุญแจที่ไม่รู้จัก
- **WHEN** คำตอบมีกุญแจที่ไม่ใช่ของ Machine หรือ Controller ใด
- **THEN** Hub ปิดการเชื่อมต่อด้วย error การพิสูจน์ตัวตน

#### Scenario: ลายเซ็นไม่ถูกต้อง
- **WHEN** ลายเซ็นตรวจกับกุญแจในคำตอบไม่ผ่าน
- **THEN** Hub ปิดการเชื่อมต่อด้วย error การพิสูจน์ตัวตน

#### Scenario: ลายเซ็นทำให้ Hub อื่น
- **WHEN** ลายเซ็นครอบ URL ของ Hub อื่น
- **THEN** Hub ปิดการเชื่อมต่อด้วย error การพิสูจน์ตัวตน

#### Scenario: คำตอบถูกส่งซ้ำ
- **WHEN** client ส่งคำตอบที่เซ็นกับ nonce ของการเชื่อมต่อก่อนหน้า
- **THEN** Hub ปิดการเชื่อมต่อด้วย error การพิสูจน์ตัวตน

### Requirement: Handshake มีเวลาจำกัด
Hub SHALL ปิดการเชื่อมต่อที่ยังไม่พิสูจน์ตัวตนภายในเวลาที่ตั้งไว้ และ SHALL ปิดการเชื่อมต่อที่ส่ง frame อื่นก่อนพิสูจน์ตัวตน

#### Scenario: client เงียบ
- **WHEN** client ไม่ส่งอะไรหลัง challenge จนหมดเวลา
- **THEN** Hub ปิดการเชื่อมต่อ

#### Scenario: frame ก่อนพิสูจน์ตัวตน
- **WHEN** client ส่ง frame อื่นก่อนตอบ challenge
- **THEN** Hub ปิดการเชื่อมต่อ

### Requirement: Hub รู้ว่าสายไหนยังใช้งานอยู่
Hub SHALL ถือหนึ่งสายต่อหนึ่งกุญแจ โดยเพิ่มเมื่อพิสูจน์ตัวตนสำเร็จ และเอาออกทันทีเมื่อสายปิดหรือไม่ตอบ heartbeat ภายในเวลาที่ตั้งไว้ เมื่อสายที่สองพิสูจน์ตัวตนด้วยกุญแจเดียวกัน Hub SHALL เก็บสายใหม่และปิดสายเก่า Member SHALL นับว่าต่ออยู่ตราบที่มี Controller ของคนนั้นต่ออยู่อย่างน้อยหนึ่งเครื่อง

#### Scenario: ตัดการเชื่อมต่อปกติ
- **WHEN** Machine ที่พิสูจน์ตัวตนแล้วปิดสาย
- **THEN** Hub นับว่า Machine นั้นออฟไลน์ทันที

#### Scenario: สายที่หยุดตอบ
- **WHEN** สายที่พิสูจน์ตัวตนแล้วหยุดตอบ heartbeat
- **THEN** Hub เอาสายออกภายในหนึ่งรอบ heartbeat และปิดสาย

#### Scenario: ต่อใหม่ขณะสายเก่ายังค้าง
- **WHEN** client พิสูจน์ตัวตนบนสายใหม่ขณะที่สายเก่าด้วยกุญแจเดียวกันยังเปิดอยู่
- **THEN** Hub ปิดสายเก่า และ client ยังต่ออยู่บนสายใหม่

#### Scenario: Controller สองเครื่องของ Member เดียว
- **WHEN** Controller เครื่องที่สองซึ่งมีกุญแจต่างกันของ Member เดียวกันพิสูจน์ตัวตน
- **THEN** ทั้งสองสายยังเปิดอยู่
