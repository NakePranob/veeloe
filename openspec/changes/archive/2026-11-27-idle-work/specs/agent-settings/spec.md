## ADDED Requirements

### Requirement: ตั้งเพดานงานพื้นหลัง
`agent.update` SHALL รับ `backgroundShare` เป็นจำนวนเต็ม 0 ถึง 100 ซึ่งเป็นเปอร์เซ็นต์ของ Budget ต่อวันที่ Idle Work และ Watch ใช้รวมกันได้ ผู้ส่ง SHALL มี Manage และ supervisor SHALL เขียนค่านี้ลงไฟล์รายชื่อ Agent `agent.listed` SHALL ส่ง `backgroundShare` ของแต่ละ Agent (ค่าเริ่มต้น 30 เมื่อยังไม่ได้ตั้ง) ทั้งสองฝั่งของ Protocol SHALL ตัดสินค่าตรงกันตาม vectors

#### Scenario: ปิดงานพื้นหลัง
- **WHEN** Owner ส่ง `agent.update` ที่มี `backgroundShare: 0`
- **THEN** Idle Work ของ Agent นั้นไม่เริ่มงานชิ้นใหม่
