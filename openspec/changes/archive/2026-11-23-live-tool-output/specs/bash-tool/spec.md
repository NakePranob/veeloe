## ADDED Requirements

### Requirement: คำสั่งที่กำลังรันส่ง output สดถึง Controller
ระหว่างที่คำสั่ง `bash` รัน worker SHALL ส่ง output ที่ออกมาให้ supervisor เป็นช่วงๆ และ supervisor SHALL ส่งข้อความ `tool.output` ที่เซ็นด้วยกุญแจของ Machine ถึง Controller ของ Member ที่เริ่ม Task นั้นเท่านั้น ข้อความ SHALL มีรหัส Task รหัสของ tool call ท้ายของ output ไม่เกิน 2 KB จำนวน byte ที่ออกมาทั้งหมด และเวลาที่รันไปแล้ว supervisor SHALL ส่งไม่เกินหนึ่งข้อความต่อวินาทีต่อคำสั่ง และ SHALL ไม่ส่งเมื่อไม่มี output ใหม่ `tool.output` SHALL ไม่ถูกเขียนลง Task log และ SHALL ไม่เปลี่ยนสิ่งที่ LLM ได้ ผลเต็มของคำสั่ง SHALL ยังเป็น `tool.result` ตามเดิม

#### Scenario: build ที่พิมพ์ต่อเนื่อง
- **WHEN** Agent รันคำสั่งที่พิมพ์ output หลายร้อยบรรทัดต่อวินาทีเป็นเวลาสามสิบวินาที
- **THEN** Controller ที่เปิดอยู่ได้ `tool.output` ไม่เกินประมาณสามสิบข้อความ แต่ละข้อความมีท้ายของ output ไม่เกิน 2 KB และเมื่อคำสั่งจบ Task log มี `tool.result` หนึ่ง event โดยไม่มี event ของ output ระหว่างทาง

#### Scenario: คำสั่งที่ไม่พิมพ์อะไร
- **WHEN** Agent รัน `sleep 30`
- **THEN** supervisor ไม่ส่ง `tool.output` สำหรับคำสั่งนั้น

#### Scenario: Member อื่น
- **WHEN** Member คนหนึ่งเริ่ม Task และคำสั่งใน Task นั้นกำลังรัน
- **THEN** Controller ของ Member คนอื่นไม่ได้ `tool.output` ของ Task นั้น
