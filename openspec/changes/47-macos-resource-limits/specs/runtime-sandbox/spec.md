## ADDED Requirements

### Requirement: macOS จำกัด CPU และหน่วยความจำของ worker
บน macOS supervisor SHALL ตั้ง CPU time limit ให้ worker ของทุก Agent จากค่าที่ตั้งได้ และ SHALL เฝ้าค่าหน่วยความจำของ worker เป็นระยะ เมื่อ worker ใช้ CPU time เกินหรือหน่วยความจำเกินกำหนด supervisor SHALL ทำให้ worker นั้นจบ และ SHALL บันทึก Runtime log ว่า Agent ไหนชน limit ใด โดยไม่บันทึกเนื้อหาหรือ path ของผู้ใช้ ค่า limit SHALL มี default ที่สมเหตุสมผลและตั้งได้ใน config; ค่าที่ไม่ถูกต้อง MUST NOT ทำให้ supervisor เริ่มไม่ได้ Turn ที่ถูกตัด SHALL จบเป็น interrupted หรือ error ตามกลไกเดิม ไม่ค้าง

#### Scenario: ใช้ CPU เกิน
- **WHEN** worker ของ Agent ใช้ CPU time เกินค่าที่ตั้งไว้
- **THEN** worker ถูกตัด และ Runtime log บอก Agent กับ limit

#### Scenario: ใช้หน่วยความจำเกิน
- **WHEN** worker ใช้หน่วยความจำเกินค่าที่ตั้งไว้
- **THEN** supervisor ฆ่า worker และเปิดใหม่ตามปกติ

#### Scenario: ค่า limit ไม่ถูกต้อง
- **WHEN** config มีค่า limit ติดลบหรืออ่านไม่ได้
- **THEN** ใช้ค่า default และ supervisor ยังเริ่มได้
