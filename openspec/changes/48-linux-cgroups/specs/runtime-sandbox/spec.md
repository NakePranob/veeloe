## ADDED Requirements

### Requirement: Linux จำกัด memory, CPU และจำนวนโปรเซสของ worker
บน Linux ที่มี systemd user session supervisor SHALL เปิด worker ของ Agent ใน cgroup v2 scope ที่มี `MemoryMax`, `CPUQuota` และ `TasksMax` ตามค่าที่ตั้งได้ เมื่อไม่มี systemd user session หรือเปิด scope ไม่ได้ supervisor SHALL ใช้การจำกัดสำรอง (CPU time limit และการเฝ้าหน่วยความจำ) และ SHALL บันทึก Runtime log ว่า cgroup ใช้ไม่ได้ ค่า limit SHALL มี default และค่าที่ไม่ถูกต้อง MUST NOT ทำให้ supervisor เริ่มไม่ได้ worker ที่ถูกตัดเพราะเกิน limit SHALL ทำให้ Turn จบเป็น interrupted หรือ error ตามกลไกเดิม ไม่ค้าง

#### Scenario: มี systemd
- **WHEN** เครื่องมี user systemd และ supervisor เปิด worker
- **THEN** worker อยู่ใน scope ที่มี MemoryMax/CPUQuota/TasksMax

#### Scenario: ไม่มี systemd
- **WHEN** เครื่องไม่มี user systemd หรือ systemd-run ล้มเหลว
- **THEN** worker ยังเปิดด้วย fallback และ Runtime log บอกว่า cgroup ใช้ไม่ได้

#### Scenario: เกินหน่วยความจำ
- **WHEN** worker ใช้หน่วยความจำเกิน limit
- **THEN** worker ถูกตัดและ Turn จบแบบ interrupted/error
