# runtime-providers Specification

## Purpose

กำหนดว่า Owner ตั้ง Provider บน Machine อย่างไร และ supervisor ส่งคำขอไป LLM แทน worker อย่างไร โดยที่ Agent ไม่เคยเห็น key ของ Provider (ADR 0042)

## Requirements

### Requirement: Owner ตั้ง Provider ที่หน้าเครื่อง
`veeloe provider add` SHALL รับ Provider สำเร็จรูปด้วย `--preset <id>` หรือ Provider อื่นที่รองรับรูปแบบ Anthropic Messages ด้วย `--name` กับ `--url` และ key ของ Provider โดย key SHALL ถูกอ่านจาก terminal แบบไม่แสดงบนจอหรือจาก stdin และ MUST NOT ถูกรับเป็น argument ของคำสั่ง ก่อนบันทึก Runtime SHALL ถามรายชื่อ model จาก Provider ด้วย key นั้น และ SHALL ไม่บันทึกเมื่อถามไม่สำเร็จ key SHALL ถูกเก็บในไฟล์ของ supervisor ที่เจ้าของอ่านเขียนได้คนเดียว และ MUST NOT ออกจาก Machine

#### Scenario: key ใช้ได้
- **WHEN** Owner รัน `veeloe provider add` แล้วใส่ URL กับ key ที่ Provider รับ
- **THEN** Runtime บันทึก Provider แสดงจำนวน model ที่ใช้ได้ และบอกขั้นต่อไป

#### Scenario: key ใช้ไม่ได้
- **WHEN** Provider ตอบว่า key ไม่ถูกต้อง หรือติดต่อ URL ไม่ได้
- **THEN** Runtime ไม่บันทึกอะไร และบอกเหตุผลกับวิธีแก้ใน terminal

#### Scenario: ชื่อซ้ำ
- **WHEN** Owner เพิ่ม Provider ด้วยชื่อที่มีอยู่แล้ว
- **THEN** Runtime ปฏิเสธ และ Provider เดิมไม่เปลี่ยน

#### Scenario: key เป็น argument
- **WHEN** Owner ใส่ key ไว้ในคำสั่ง เช่น `--key` หรือเป็นคำท้ายคำสั่ง
- **THEN** Runtime ปฏิเสธโดยไม่พิมพ์ key นั้นออกมา และบอกให้พิมพ์ตอนถามหรือส่งทาง stdin

### Requirement: Provider สำเร็จรูป
Runtime SHALL มี Provider สำเร็จรูปในตารางเดียว คือ `anthropic` (`https://api.anthropic.com`, `x-api-key`), `opencode-go` (`https://opencode.ai/inference/go`, `x-api-key`) และ `openrouter` (`https://openrouter.ai/api`, `Bearer`) Provider สำเร็จรูป SHALL ใช้ URL และวิธีส่ง key ตามตารางโดยไม่ลองเดา ส่วน Provider ที่ใส่ URL เอง SHALL ลอง `x-api-key` ก่อนแล้วจึง `Bearer` Provider ที่บันทึก SHALL จำว่ามาจาก Provider สำเร็จรูปตัวไหน ทุกคำขอที่ supervisor ส่งไป Provider SHALL มี `user-agent: veeloe/<version>` และคำขอไป `opencode-go` SHALL มี `x-opencode-session` เป็นรหัสของ Task ที่คำขอนั้นเป็นของ ซึ่งคงที่ตลอด Task worker SHALL บอกรหัส Task มากับคำขอทาง IPC และ supervisor MUST NOT ส่ง header `x-veeloe-*` ของ Runtime เองต่อไปที่ Provider

#### Scenario: OpenRouter
- **WHEN** Owner เพิ่ม `--preset openrouter` ซึ่งตอบรายชื่อ model ได้โดยไม่ต้องมี key
- **THEN** Runtime บันทึกแบบ `Bearer` ตามตาราง ไม่ใช่ `x-api-key`

#### Scenario: OpenCode Go
- **WHEN** Agent ที่ใช้ Provider จาก `opencode-go` ทำ Turn ใน Task หนึ่ง
- **THEN** ทุกคำขอของ Task นั้นมี `x-opencode-session` เป็นรหัส Task มี `user-agent` เป็น `veeloe/<version>` และไม่มี header `x-veeloe-*`

### Requirement: เพิ่ม Provider แบบถามทีละขั้น
เมื่อ stdin และ stdout เป็น terminal และคำสั่งไม่ได้บอก Provider มา `veeloe provider add` SHALL ให้เลือกจากรายการเลขของ Provider สำเร็จรูปกับ "Custom (enter a URL)" ถ้าเลือก Provider สำเร็จรูป SHALL ถามแค่ key ถ้าเลือก Custom SHALL ถามชื่อ, URL และ key ตามลำดับ และถามซ้ำเมื่อคำตอบใช้ไม่ได้ เมื่อไม่มี terminal Runtime MUST NOT ถามอะไร และ SHALL จบด้วย exit code ที่ไม่ใช่ 0 พร้อมบอกว่าขาด flag ตัวไหน

#### Scenario: เลือกจากรายการ
- **WHEN** Owner รัน `veeloe provider add` ที่ terminal เลือก Custom ตอบชื่อผิดรูปแบบหนึ่งครั้ง แล้วตอบชื่อ URL และ key ที่ใช้ได้
- **THEN** Runtime ถามชื่ออีกครั้ง แล้วตรวจ key กับ Provider และบันทึก

#### Scenario: ไม่มี terminal
- **WHEN** สคริปต์รัน `veeloe provider add` โดยไม่มี `--name` และไม่มี terminal
- **THEN** Runtime ไม่ถามอะไร และออกด้วย error ที่บอกว่าขาด `--name`

### Requirement: Owner ดูและลบ Provider ได้
`veeloe provider list` SHALL แสดงชื่อและ URL ของทุก Provider และ MUST NOT แสดง key `veeloe provider remove [<name>]` SHALL ลบ Provider นั้น ถ้าไม่ได้ระบุชื่อและมี terminal SHALL ให้เลือกจากรายการเลข ก่อนลบ Runtime SHALL บอกชื่อ Agent ทุกตัวที่ใช้ Provider นั้นจากรายชื่อ Agent และบอกว่า Agent เหล่านั้นจะหยุดตอบจนกว่าจะได้ Provider ใหม่ แล้วถามยืนยันโดยค่าเริ่มต้นคือไม่ลบ `--yes` SHALL ข้ามการถาม และเมื่อไม่มี terminal Runtime SHALL ไม่ลบถ้าไม่มี `--yes` Agent ที่ใช้ Provider ที่ถูกลบ SHALL จบ Turn ถัดไปด้วย error ที่บอกว่าไม่มี Provider แทนที่จะพัง

#### Scenario: ดูรายชื่อ
- **WHEN** Owner รัน `veeloe provider list`
- **THEN** terminal แสดงชื่อกับ URL และไม่มี key ส่วนใดเลย

#### Scenario: ลบแบบเลือก
- **WHEN** Owner รัน `veeloe provider remove` ที่ terminal เลือก Provider ที่ Agent ใช้อยู่ แล้วกด Enter ตอนถามยืนยัน
- **THEN** terminal แสดงชื่อ Agent ที่ใช้ Provider นั้น และไม่มีอะไรถูกลบ

#### Scenario: ลบโดยไม่มี terminal
- **WHEN** สคริปต์รัน `veeloe provider remove main` โดยไม่มี `--yes`
- **THEN** Runtime ไม่ลบ และบอกให้รันใหม่พร้อม `--yes`

#### Scenario: ลบ Provider ที่ Agent ใช้อยู่
- **WHEN** Owner ลบ Provider แล้วส่งข้อความหา Agent ที่ใช้ Provider นั้น
- **THEN** Turn จบด้วย error code `provider.missing`

### Requirement: worker คุยกับ LLM ผ่าน proxy ของ supervisor เท่านั้น
supervisor SHALL รับคำขอไป LLM จาก worker ผ่านช่อง IPC ของ worker ตัวนั้นเท่านั้น ใส่ key ของ Provider ที่ Agent ตัวนั้นใช้ แล้วส่งต่อ Agent ที่เป็นเจ้าของคำขอ SHALL มาจากช่อง IPC ที่คำขอเข้ามา ไม่ใช่จากสิ่งที่คำขอระบุ supervisor MUST NOT เปิด port บนเครื่องให้ worker เรียก LLM worker MUST NOT ได้รับ key ทั้งทางตัวแปร environment, IPC หรือคำตอบ supervisor SHALL ใช้ Provider กับ model ของ Agent ตัวนั้น ไม่ใช่ค่าที่คำขอระบุ และ SHALL ส่งต่อเฉพาะ path ที่ใช้คุยกับ LLM (ADR 0008, 0042)

#### Scenario: worker ขอ LLM
- **WHEN** worker ส่งคำขอทาง IPC ของตัวเอง
- **THEN** Provider ได้คำขอพร้อม key และ worker ได้คำตอบตามที่ Provider ตอบ

#### Scenario: โปรเซสอื่นบนเครื่อง
- **WHEN** โปรเซสบนเครื่องที่ไม่ใช่ worker ลองหาทางเรียก LLM ผ่าน supervisor
- **THEN** ไม่มี port ให้ต่อ และ supervisor ไม่ติดต่อ Provider

#### Scenario: worker ขอ model อื่น
- **WHEN** คำขอของ worker ระบุ model ที่ไม่ใช่ของ Agent
- **THEN** Provider ได้คำขอด้วย model ของ Agent

#### Scenario: worker ขอ path อื่น
- **WHEN** worker ขอ path ที่ไม่ใช่การส่งข้อความหรือนับ token
- **THEN** supervisor ปฏิเสธและไม่ติดต่อ Provider

#### Scenario: Provider ล่ม
- **WHEN** ติดต่อ Provider ไม่ได้ หรือ Provider ตอบ error
- **THEN** worker ได้ error ที่บอกว่าเป็นที่ Provider และ Turn จบด้วย code `provider.failed` หรือ `provider.unreachable`

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
