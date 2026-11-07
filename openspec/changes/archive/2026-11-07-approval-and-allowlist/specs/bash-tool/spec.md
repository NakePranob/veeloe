# Spec Delta

## MODIFIED Requirements

### Requirement: Agent มี tool bash
Agent ทุกตัว SHALL มี tool ชื่อ `bash` ที่รับคำสั่งหนึ่งบรรทัดหรือหลายบรรทัด และอาจระบุเวลาจำกัดเป็นวินาที worker SHALL รันคำสั่งด้วย bash โดยเริ่มที่ Workdir ทุกครั้ง การ `cd` หรือตัวแปรที่ตั้งในคำสั่งหนึ่ง SHALL NOT ติดไปคำสั่งถัดไป คำสั่ง SHALL ไม่มี stdin และ SHALL NOT ได้ตัวแปร environment ที่ Runtime ใช้คุยกับ supervisor คำสั่งที่ LLM ขอใน Turn เดียวกัน SHALL รันทีละคำสั่งตามลำดับ คำสั่งที่ไม่อยู่ใน Allowlist ของ Agent SHALL NOT ถูกรัน แต่ SHALL เขียน `approval.requested` ลง log แล้วหยุด Turn ไว้จนกว่าจะได้ `approval.answer` อนุมัติ หมดเวลา หรือถูกปฏิเสธ เมื่อได้อนุมัติ worker SHALL รันคำสั่งนั้นภายใต้ sandbox ของ worker เมื่อไม่ได้อนุมัติ worker SHALL ส่งผลที่เป็น error ให้ LLM ว่าไม่ได้รับอนุมัติ tool ที่ทำกับไฟล์ (`read`, `write`, `edit`, `glob`, `grep`) SHALL NOT ผ่าน Allowlist เพราะ sandbox คุมอยู่แล้ว (ADR 0008, 0030)

#### Scenario: รันคำสั่ง
- **WHEN** LLM ขอ `bash` ด้วยคำสั่ง `pwd`
- **THEN** LLM ได้ path ของ Workdir

#### Scenario: cd ไม่ติดข้ามคำสั่ง
- **WHEN** LLM ขอ `cd /tmp` แล้วขอ `pwd` ในคำสั่งถัดไป
- **THEN** คำสั่งที่สองได้ path ของ Workdir

#### Scenario: คำสั่งที่รอ input
- **WHEN** LLM ขอคำสั่งที่อ่าน stdin เช่น `cat` เปล่าๆ
- **THEN** คำสั่งจบทันทีเพราะไม่มี input และ Turn เดินต่อ

#### Scenario: คำสั่งใน Allowlist รันเลย
- **WHEN** Allowlist มี `pwd` แล้ว LLM ขอ `pwd`
- **THEN** คำสั่งรันทันทีโดยไม่มี `approval.requested` ใน log

#### Scenario: คำสั่งนอก Allowlist ต้องขอ
- **WHEN** Allowlist ไม่มี `rm -rf dist` แล้ว LLM ขอคำสั่งนั้น
- **THEN** log มี `approval.requested` และคำสั่งยังไม่รันจนกว่าจะได้อนุมัติ
