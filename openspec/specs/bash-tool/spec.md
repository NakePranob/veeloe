# bash-tool Specification

## Purpose

กำหนดว่า Agent รันคำสั่ง bash บน Machine อย่างไร ภายใต้ sandbox ของ worker และ LLM ได้ผลของคำสั่งกลับไปแบบไหน เพื่อให้ Agent ทำงานจริงบนเครื่องได้ (ADR 0008)

## Requirements

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

### Requirement: LLM ได้ผลของคำสั่งพร้อม exit code
ผลที่ LLM ได้ SHALL เป็น stdout และ stderr รวมกันตามลำดับที่ออก ตามด้วย exit code คำสั่งที่จบด้วย exit code ไม่ใช่ 0 SHALL ถูกส่งเป็นผลที่เป็น error ผลที่ยาวเกินเพดาน SHALL ถูกตัดตอนต้นทิ้งให้เหลือตอนท้าย พร้อมบอกว่าตัดไปเท่าไหร่ ผลทั้งหมด SHALL ถูกบันทึกเป็น event ของ Task ตาม ADR 0018

#### Scenario: คำสั่งล้มเหลว
- **WHEN** คำสั่งจบด้วย exit code 1 พร้อมข้อความใน stderr
- **THEN** LLM ได้ข้อความนั้นกับ exit code 1 เป็นผลที่เป็น error และ Turn เดินต่อ

#### Scenario: ผลยาวเกิน
- **WHEN** คำสั่งพิมพ์ออกมาเกินเพดาน
- **THEN** LLM ได้ตอนท้ายของผลไม่เกินเพดาน พร้อมบรรทัดที่บอกจำนวนที่ตัดไป

### Requirement: คำสั่งมีเวลาจำกัด
คำสั่งที่ไม่ระบุเวลา SHALL ถูกจำกัดที่ 120 วินาที และเวลาที่ระบุ SHALL ไม่เกิน 600 วินาที เมื่อครบเวลา worker SHALL หยุดคำสั่งพร้อมโปรเซสลูกทั้งหมด แล้วส่งผลที่ได้ถึงตอนนั้นเป็น error ที่บอกว่าหมดเวลา

#### Scenario: คำสั่งค้าง
- **WHEN** LLM ขอ `sleep 1000` โดยไม่ระบุเวลา
- **THEN** หลัง 120 วินาที คำสั่งถูกหยุด ไม่เหลือโปรเซสค้าง LLM ได้ error ว่าหมดเวลา และ Turn เดินต่อ

#### Scenario: ขอเวลาเกินเพดาน
- **WHEN** LLM ขอเวลา 3600 วินาที
- **THEN** คำสั่งถูกจำกัดที่ 600 วินาที
