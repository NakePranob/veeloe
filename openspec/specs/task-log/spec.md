# task-log Specification

## Purpose

กำหนดว่า Task เก็บเป็น event log แบบต่อท้ายอย่างเดียวบน Runtime อย่างไร Turn เริ่มและจบเมื่อไหร่ และ Controller ได้ event และตามทันหลังหลุดได้อย่างไร (ADR 0018)

## Requirements

### Requirement: Task เป็น event log ที่ต่อท้ายอย่างเดียว
worker SHALL เก็บทุก Task ของ Agent เป็นลำดับของ event ในฐานข้อมูลของ Agent ตัวนั้น แต่ละ event SHALL มีเลขลำดับภายใน Task ที่เริ่มที่ 1 และเพิ่มทีละ 1 event MUST NOT ถูกแก้หรือลบ event ของ v0.1 SHALL มีข้อความของ Member พร้อมชื่อ Member, การเริ่ม Turn, ผลจาก LLM ตามที่ได้รับทุกตัวอักษรรวมถึง thinking block, การเรียก tool กับผลของ tool และการจบ Turn พร้อมเหตุผล ฐานข้อมูล SHALL อยู่ข้าง Workdir ไม่ใช่ข้างใน (ADR 0032)

#### Scenario: Turn ที่จบปกติ
- **WHEN** Owner ส่งข้อความแล้ว LLM ตอบ
- **THEN** log มีข้อความของ Owner, การเริ่ม Turn, ผลจาก LLM และการจบ Turn ตามลำดับ เลขต่อกันไม่ขาด

#### Scenario: เริ่มใหม่
- **WHEN** worker เริ่มใหม่
- **THEN** event เดิมทุกตัวยังอยู่ด้วยเลขเดิม

### Requirement: Owner เริ่มและคุยต่อใน Task ได้
ข้อความถึง Agent SHALL ระบุรหัสข้อความ, รหัส Task และข้อความ ข้อความแรกของรหัส Task ใหม่ SHALL เริ่ม Task ใหม่ และข้อความต่อมาใน Task เดิม SHALL ต่อจากบทสนทนาเดิม ข้อความที่มีรหัสข้อความซ้ำ SHALL NOT ถูกเพิ่มซ้ำ Turn SHALL ทำในนามของ Member ที่ส่งข้อความนั้น

#### Scenario: Task ใหม่
- **WHEN** Owner ส่งข้อความแรกด้วยรหัส Task ใหม่
- **THEN** worker สร้าง Task และเริ่ม Turn

#### Scenario: คุยต่อ
- **WHEN** Owner ส่งข้อความที่สองใน Task เดิม
- **THEN** LLM ได้บทสนทนาเดิมทั้งหมดตามลำดับ ตามด้วยข้อความใหม่

#### Scenario: ส่งซ้ำ
- **WHEN** ข้อความเดิมถูกส่งอีกครั้งเพราะ Controller ต่อใหม่
- **THEN** log ไม่มีข้อความนั้นซ้ำและไม่มี Turn ใหม่

### Requirement: Agent ทำทีละ Turn
Agent SHALL ทำได้ทีละ Turn ข้อความที่มาถึงระหว่างที่ Turn ทำอยู่ SHALL ได้ error code `agent.busy` และ SHALL NOT ถูกเพิ่มลง log จนกว่าคิวงานจะมาใน `one-writer-queue`

#### Scenario: ส่งระหว่าง Turn
- **WHEN** Owner ส่งข้อความขณะที่ Agent ยังทำ Turn ก่อนหน้าอยู่
- **THEN** Controller ได้ `agent.busy` และ log ไม่เปลี่ยน

### Requirement: harness ทำ Turn จาก log และเรียก tool เป็นรอบ
harness SHALL สร้างบทสนทนาที่ส่งให้ LLM จาก event ใน log เท่านั้น เมื่อ LLM ขอเรียก tool harness SHALL เรียก tool บันทึกผล แล้วส่งให้ LLM ต่อจนกว่า LLM จะตอบโดยไม่ขอ tool เมื่อ LLM ขอ tool ที่ Agent ไม่มี harness SHALL ส่งผลว่าเป็น error ให้ LLM แทนการหยุด Turn เมื่อ Provider ล้มเหลว Turn SHALL จบด้วย error code ที่บอกว่าเป็นที่ Provider

#### Scenario: เรียก tool
- **WHEN** LLM ขอเรียก tool ที่ Agent มี
- **THEN** log มีการเรียกกับผลของ tool และ LLM ได้ผลนั้นในคำขอถัดไป

#### Scenario: tool ที่ไม่มี
- **WHEN** LLM ขอ tool ที่ Agent ไม่มี
- **THEN** LLM ได้ผลที่เป็น error และ Turn ยังเดินต่อ

#### Scenario: Provider ล้มเหลว
- **WHEN** Provider ตอบ error กลาง Turn
- **THEN** Turn จบด้วยเหตุผลที่มี error code และ Task ยังคุยต่อได้

### Requirement: event ไปถึง Member ที่เริ่ม Task และตามทันได้
supervisor SHALL ส่งทุก event ใหม่ของ Task ในซองที่เซ็นด้วยกุญแจของ Machine ถึง Member ที่เริ่ม Task นั้น (ADR 0034, 0060) Controller SHALL ขอ event ของ Task หลังเลข N ได้ด้วยคำขอที่เซ็น และ supervisor SHALL ตอบเฉพาะ Task ที่ Member ของคนขอเป็นคนเริ่ม คำตอบที่ยาว SHALL แบ่งเป็นหลายซองตามลำดับ

#### Scenario: event ใหม่
- **WHEN** worker บันทึก event ใหม่ใน Task
- **THEN** Controller ของ Member ที่เริ่ม Task ได้ event นั้นพร้อมเลขลำดับ

#### Scenario: ต่อใหม่หลังหลุด
- **WHEN** Controller หลุดไประหว่าง Turn แล้วต่อใหม่และขอ event หลังเลขล่าสุดที่มี
- **THEN** ได้ event ที่ขาดไปครบตามลำดับ และไม่ได้ event ที่มีแล้ว

#### Scenario: Task ของคนอื่น
- **WHEN** คำขอ event มาจาก Member ที่ไม่ได้เริ่ม Task นั้น
- **THEN** supervisor ตอบ error code `task.not_found` และไม่ส่ง event
