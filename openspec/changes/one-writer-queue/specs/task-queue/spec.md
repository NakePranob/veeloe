# Spec Delta

## Purpose

กำหนดให้ Controller ส่งข้อความเข้าคิวได้ขณะ Agent กำลังทำ Turn โดย Runtime ใช้คิวเดิมและประมวลผลตามลำดับ

## ADDED Requirements

### Requirement: ส่งข้อความเข้าคิวขณะ Agent ไม่ว่าง
Controller SHALL ยอมให้ผู้ใช้ส่งข้อความใน Task ขณะ Agent กำลังทำ Turn; Runtime SHALL เก็บข้อความนั้นในคิวของ Agent และประมวลผลหลัง Turn ปัจจุบันจบ; Controller MUST แสดงว่าข้อความจะรอ Turn ปัจจุบัน

#### Scenario: ส่งขณะ Turn กำลังทำ
- **WHEN** Agent กำลังทำ Turn และผู้ใช้พิมพ์ข้อความใหม่แล้วกด Send
- **THEN** ข้อความถูกส่งและรอในคิว ไม่ถูกปฏิเสธเพราะ Agent ไม่ว่าง

#### Scenario: ข้อความในคิวถูกประมวลผลต่อ
- **WHEN** Turn ปัจจุบันจบ
- **THEN** ข้อความในคิวเริ่มเป็น Turn ถัดไปตามลำดับ

#### Scenario: ยังไม่ได้พิมพ์ข้อความ
- **WHEN** Agent ไม่ว่างและช่องข้อความว่าง
- **THEN** ปุ่ม Stop ยังแสดงเหมือนเดิม
