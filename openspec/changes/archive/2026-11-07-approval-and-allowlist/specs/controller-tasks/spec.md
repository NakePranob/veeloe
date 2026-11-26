# Spec Delta

## ADDED Requirements

### Requirement: หน้า Task แสดงการ์ด Approval และตอบได้ตามสิทธิ์
หน้า Task SHALL แสดง `approval.requested` เป็นการ์ดพร้อมคำสั่งที่ขอ ชื่อ Member ที่ต้องตอบไม่ได้เพราะคำขอไปถึงทุกคนที่มี Approve และการ์ด SHALL แสดงสถานะว่ารออยู่ อนุมัติแล้ว ปฏิเสธแล้ว หรือหมดเวลา ตาม `approval.answered` หรือเวลาหมดอายุ การ์ด SHALL มีปุ่มอนุมัติ ปฏิเสธ และบอกให้ทำอย่างอื่นพร้อมช่องพิมพ์ error ที่ได้ SHALL แสดงเป็นคำในภาษาของ Owner ตาม code (ADR 0065)

#### Scenario: คำขอรออยู่
- **WHEN** log มี `approval.requested` ที่ยังไม่มีคำตอบ
- **THEN** หน้า Task แสดงการ์ดว่ารออยู่พร้อมสามปุ่ม

#### Scenario: หมดเวลาแล้ว
- **WHEN** คำขอเลยเวลาหมดอายุแล้วยังไม่มีคำตอบ
- **THEN** การ์ดแสดงว่าหมดเวลาและปุ่มกดไม่ได้

### Requirement: หน้าสร้าง Agent ติ๊กชุดอ่านอย่างเดียวได้
หน้าสร้าง Agent SHALL มีช่องติ๊กชุดคำสั่งอ่านอย่างเดียวเก้ารายการ (`ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `git status`, `git diff`, `git log`) ที่ติ๊กไว้ตั้งแต่ต้น Member SHALL เอาออกได้ทีละตัวก่อนกดสร้าง คำทุกคำ SHALL มีทั้งภาษาไทยและอังกฤษ (ADR 0065)

#### Scenario: เอาออกก่อนสร้าง
- **WHEN** Owner เอาติ๊ก `cat` ออกแล้วกดสร้าง
- **THEN** `agent.create` ที่ส่งไปไม่มี `cat` ใน `allowlist`

### Requirement: หน้า Allowlist ของ Agent แก้ได้ทั้งชุด
หน้า Agent SHALL มีหน้าตั้งค่า Allowlist ที่แสดงรายการปัจจุบัน เพิ่มรายการใหม่ และลบรายการเดิมได้ การบันทึก SHALL ส่ง `agent.update` ที่มี `allowlist` ทั้งชุด ระหว่างรอ Machine ตอบ SHALL แสดงว่ากำลังบันทึก เมื่อ Machine ออฟไลน์ปุ่มบันทึก SHALL ใช้ไม่ได้และหน้าบอกว่า Machine ต้องออนไลน์

#### Scenario: เพิ่มรายการ
- **WHEN** Owner พิมพ์ `npm test` กดเพิ่ม แล้วกดบันทึกขณะ Machine ออนไลน์
- **THEN** หลัง Machine ตอบ หน้า Allowlist แสดง `npm test` ในรายการ
