## ADDED Requirements

### Requirement: proxy นับทุก token ที่ Provider รายงาน
supervisor SHALL อ่าน `usage` จากทุกคำตอบของ `POST /v1/messages` ที่ส่งต่อจาก `llm.request` ของ worker ทั้งแบบ JSON และแบบ SSE แล้วบวก `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` และ `output_tokens` เข้ายอดของ Agent ที่ช่อง IPC เป็นของมัน ในวันของ Budget ที่คำตอบนั้นจบ ยอด SHALL เป็นของ Agent ไม่ว่า Task นั้นตรึงไว้กับ Provider หรือ model ไหน และการเปลี่ยน Provider หรือ model SHALL ไม่ล้างยอด การนับ MUST NOT แก้ไบต์ของคำตอบที่ส่งถึง worker `POST /v1/messages/count_tokens` MUST NOT ถูกนับ

#### Scenario: คำตอบแบบ SSE
- **WHEN** Provider ส่ง `message_start` ที่มี input 1,000 และ cache read 500 แล้วส่ง `message_delta` ที่มี output 200
- **THEN** worker ได้คำตอบตามที่ Provider ส่ง และยอดของ Agent วันนี้เพิ่ม 1,700

#### Scenario: คำตอบแบบ JSON
- **WHEN** Provider ตอบ JSON ที่มี `usage`
- **THEN** ยอดของ Agent วันนี้เพิ่มเท่าผลรวมของสี่ field ใน `usage`

#### Scenario: Task ที่ตรึง model อื่นไว้
- **WHEN** Agent มีสอง Task ที่ตรึงไว้กับ model ต่างกัน และทั้งสอง Task คุยกับ LLM
- **THEN** token ของทั้งสอง Task บวกเข้ายอดเดียวกันของ Agent

### Requirement: วันของ Budget เริ่มตอน 04:00 ตามเวลาของ Machine
supervisor SHALL เก็บยอดของ Agent แต่ละตัวพร้อมวันที่ของวันนั้น โดยวันที่คือวันตามเวลาของ Machine ของเวลาที่ลบไป 4 ชั่วโมง ยอดของวันก่อน SHALL ไม่ถูกนับเมื่อวันที่เปลี่ยน supervisor MUST NOT ใช้นาฬิกาจับเวลาเพื่อรีเซ็ต ยอด SHALL อยู่รอดเมื่อ supervisor เริ่มใหม่ในวันเดียวกัน

#### Scenario: ข้าม 04:00
- **WHEN** Agent ใช้ไป 3M ตอน 03:59 แล้วส่งคำขอตอน 04:00
- **THEN** ยอดของวันนี้เริ่มจาก 0 ก่อนนับคำขอนั้น

#### Scenario: เปิดเครื่องข้ามวัน
- **WHEN** Machine ปิดตั้งแต่เย็นวานแล้วเปิดตอน 09:00
- **THEN** ยอดของวันนี้เป็น 0

#### Scenario: เริ่ม supervisor ใหม่ในวันเดียวกัน
- **WHEN** supervisor เริ่มใหม่ตอนบ่ายหลังใช้ไป 2M ตอนเช้า
- **THEN** ยอดของวันนี้ยังเป็น 2M

### Requirement: Budget หมดแล้ว Turn จบหลังคำขอที่ส่งไปแล้ว และงานใหม่ไม่เริ่ม
Agent ทุกตัว SHALL มี Budget เป็นจำนวน token ต่อวัน ค่าเริ่มต้น 10,000,000 ซึ่ง Agent ที่สร้างก่อน change นี้ก็ได้ด้วย เมื่อยอดของวันนี้ถึงหรือเกิน Budget supervisor SHALL ตอบ `llm.request` ของ `POST /v1/messages` ถัดไปของ Agent นั้นด้วยคำปฏิเสธของตัวเองที่มี code `budget.exhausted` และบอกให้ไม่ลองซ้ำ โดยไม่ติดต่อ Provider และ worker MUST NOT ส่งคำขอนั้นซ้ำ คำขอที่ส่งไปก่อนแล้ว SHALL ตอบจนจบและถูกนับ Turn ที่ทำอยู่ SHALL จบด้วย `turn.ended` ที่มี `reason: "error"` และ `code: "budget.exhausted"` โดยไฟล์และ event เดิมอยู่ครบ supervisor SHALL ตอบ `task.message` ที่มาถึง Agent ที่ Budget หมดด้วย error `budget.exhausted` และ MUST NOT ส่งข้อความนั้นถึง worker

#### Scenario: หมดกลาง Turn
- **WHEN** Turn หนึ่งเรียก LLM สามรอบ และยอดถึง Budget หลังคำตอบรอบที่สอง
- **THEN** คำตอบรอบที่สองถูกบันทึกครบ คำขอรอบที่สามถูกปฏิเสธครั้งเดียวโดยไม่ถึง Provider และ Turn จบด้วย code `budget.exhausted`

#### Scenario: ส่งข้อความใหม่ตอน Budget หมด
- **WHEN** Owner ส่ง `task.message` หา Agent ที่ยอดวันนี้เกิน Budget
- **THEN** Owner ได้ error `budget.exhausted` ที่ `ref` ตรงกับซองนั้น และไม่มี event ใหม่ใน Task

#### Scenario: Agent ตัวอื่นไม่โดนด้วย
- **WHEN** Budget ของ Agent ตัวหนึ่งหมด
- **THEN** Agent ตัวอื่นบน Machine เดียวกันยังคุยกับ Provider ได้
