## Context

`agent.listed` มี `egress` ต่อ Agent แล้ว; Controller เก็บ Machine.egress เป็น union และ EgressSection แก้ลิสต์เดียว

## Decisions

- เพิ่มคอลัมน์ `egress` ในตาราง agent (JSON text, ค่าเริ่มต้น `[]`) และบันทึกจาก `agent.listed` ทุกครั้ง
- `setEgress(machine, egress, agent?)`: มี agent → ส่ง `{ egress, agent }`; ไม่มี → แบบเดิม
- EgressSection ใช้ picker ของ design system เลือก Agent; ค่าเริ่มต้น "ทุก Agent" เพื่อไม่เปลี่ยนพฤติกรรมเดิมของผู้ใช้
- รายการที่แสดงมาจาก Agent ที่เลือก (หรือ union เมื่อเลือกทุก Agent) หลัง Machine เซ็นกลับมา

## Risks

- ถ้า Controller รุ่นนี้คุยกับ Runtime เก่า `agent` จะถูกเมินและกลายเป็นแก้ทุก Agent (เหมือน #43) — ยอมรับช่วงเปลี่ยนรุ่น
