## REMOVED Requirements

### Requirement: Agent ทำทีละ Turn
**Reason**: ADR 0080 แทนที่ ADR 0011 Turn ของคนละ Task ทำพร้อมกันได้ และข้อความระหว่าง Turn ต่อคิวของ Task (task-queue) ไม่ได้ตอบ `agent.busy` ข้อนี้ขัดกับ task-queue และโค้ดอยู่แล้วก่อน change นี้
**Migration**: ข้อความที่เข้าระหว่าง Turn ใช้กฎของ task-queue `agent.busy` ยังอยู่ใน Protocol สำหรับ `trigger.run` ของ Schedule ที่รอบก่อนยังไม่จบ
