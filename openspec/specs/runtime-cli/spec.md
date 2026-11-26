# runtime-cli Specification

## Purpose

กำหนดว่าคำสั่ง `veeloe` พา Owner ตั้ง Machine ครั้งแรก บอกสถานะ และช่วยเหลืออย่างไร เพื่อให้ทุกคำสั่งจบด้วยขั้นต่อไปและทุก error บอกวิธีแก้ ข้อความใน terminal เป็นภาษาอังกฤษ (กฎสองภาษาของ ADR 0065 ใช้กับ Controller เท่านั้น)

## Requirements

### Requirement: `veeloe` ครั้งแรกพาตั้งจนเสร็จ
เมื่อรัน `veeloe` บน Machine ที่ยังไม่ได้ Pairing และมี terminal Runtime SHALL ทำ Pairing ในคำสั่งนั้นเลย โดยแสดง QR กับลิงก์แล้วรอ ถามที่อยู่ Hub ถ้ายังไม่รู้ แล้วถ้ายังไม่มี Provider SHALL พาเพิ่ม Provider แบบถามทีละขั้น จากนั้นเริ่ม supervisor ตามปกติ เมื่อไม่มี terminal และยังไม่ได้ Pairing Runtime SHALL ไม่ถามอะไร และจบด้วย exit code ที่ไม่ใช่ 0 พร้อมบอกคำสั่งที่ต้องรัน Machine ที่ตั้งแล้ว SHALL เริ่มเหมือนเดิม `veeloe pair` ที่สำเร็จ SHALL บอกขั้นต่อไป คือ `veeloe` และ `veeloe provider add` ถ้ายังไม่มี Provider

#### Scenario: ครั้งแรกที่ terminal
- **WHEN** Owner รัน `veeloe` บนเครื่องใหม่ที่ terminal
- **THEN** Runtime แสดง QR รอ Pairing พาเพิ่ม Provider แล้วเริ่มทำงาน

#### Scenario: ครั้งแรกโดยไม่มี terminal
- **WHEN** service manager รัน `veeloe` บนเครื่องที่ยังไม่ได้ Pairing
- **THEN** Runtime ออกด้วย error ที่บอกให้รัน `veeloe pair`, `veeloe provider add` และ `veeloe` จาก terminal

### Requirement: `veeloe status` บอกสถานะในหน้าเดียว
`veeloe status` SHALL แสดงว่า Machine ได้ Pairing แล้วหรือยัง พร้อม URL ของ Hub และชื่อ Machine, Provider ทุกตัวพร้อมชื่อ ว่ามาจาก Provider สำเร็จรูปตัวไหนหรือใส่เอง และ URL, Agent ทุกตัวพร้อม Provider และ model, ว่ามี supervisor ของโฟลเดอร์ Runtime นี้ทำงานอยู่หรือไม่ และขั้นต่อไปถ้ายังขาดอะไร `veeloe status` MUST NOT แสดง key ส่วนใดเลย supervisor SHALL เขียนไฟล์ pid ตอนเริ่มและลบตอนจบ และไฟล์ pid ที่ชี้ไปโปรเซสที่ไม่อยู่แล้ว SHALL ถือว่าไม่ได้ทำงาน

#### Scenario: ยังไม่ได้ตั้ง
- **WHEN** Owner รัน `veeloe status` บนเครื่องที่ยังไม่ได้ Pairing
- **THEN** terminal แสดงว่ายังไม่ได้ Pairing และขั้นต่อไปคือรัน `veeloe`

#### Scenario: supervisor ถูก kill
- **WHEN** supervisor ถูก kill จนไฟล์ pid ค้าง แล้ว Owner รัน `veeloe status`
- **THEN** terminal แสดงว่า Runtime ไม่ได้ทำงาน

### Requirement: ทุกคำสั่งมีคำอธิบาย
`veeloe --help`, `veeloe help <command>` และ `<command> --help` SHALL แสดงคำอธิบายสั้นและตัวอย่างของคำสั่ง คำสั่งที่ไม่รู้จัก SHALL ได้วิธีใช้สั้นๆ กับ "run veeloe --help" และจบด้วย exit code ที่ไม่ใช่ 0 โดย MUST NOT พิมพ์ argument ที่ได้มาซ้ำ เพราะอาจเป็น key ที่วางผิดที่

#### Scenario: คำสั่งที่ไม่รู้จัก
- **WHEN** Owner รัน `veeloe frobnicate`
- **THEN** terminal แสดงวิธีใช้สั้นๆ และบอกให้รัน `veeloe --help`

### Requirement: `veeloe memory` แสดง Memory ที่ Turn ถัดไปเห็น

`veeloe memory <agent>` SHALL แสดงชื่อกับ id ของ Agent, ที่อยู่ของ `MEMORY.md` ซึ่งอ้างจากโฟลเดอร์ Runtime, จำนวนตัวอักษรในไฟล์ และเนื้อหาที่ Turn ถัดไปได้รับหลังตัดตามเพดาน 4,000 ตัวอักษร; คำสั่ง SHALL รับ Agent ได้ทั้ง id และชื่อ; ชื่อที่ตรงกับมากกว่าหนึ่ง Agent MUST ถูกปฏิเสธพร้อมบอกให้ใช้ id; Agent ที่อยู่ในถังขยะ SHALL อ่านได้และ MUST ติดว่า `(in the trash)`; Agent ที่ไม่รู้จัก SHALL จบด้วย exit code 2; ไม่มีไฟล์ SHALL บอกว่า prompt ไม่มี Memory และ MUST NOT สร้าง Workdir หรือไฟล์ว่าง

#### Scenario: อ่าน Memory ของ Agent ที่มีไฟล์
- **WHEN** Owner รัน `veeloe memory Pang`
- **THEN** terminal แสดง id ของ Agent, ที่อยู่ไฟล์, จำนวนตัวอักษร และเนื้อหา Memory ที่ Turn ถัดไปเห็น

#### Scenario: ยังไม่มี MEMORY.md
- **WHEN** Owner รัน `veeloe memory` ให้ Agent ที่ยังไม่มีไฟล์
- **THEN** terminal บอกว่า prompt ไม่มี Memory และไม่มีโฟลเดอร์ใหม่ถูกสร้าง

#### Scenario: ชื่อซ้ำกันสอง Agent
- **WHEN** Owner รัน `veeloe memory` ด้วยชื่อที่ตรงกับสอง Agent
- **THEN** terminal ปฏิเสธและบอกให้ระบุ id
