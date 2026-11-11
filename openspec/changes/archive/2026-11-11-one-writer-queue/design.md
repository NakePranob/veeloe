## Context

- `controller/src/pages/task/ui/TaskPage.tsx` ปิด Send เมื่อ `busy`
- `packages/runtime/crates/runtime-supervisor/src/workers.rs` มี `mpsc::UnboundedSender` ต่อ Agent; `Workers::send` ใส่ frame เข้าคิวถ้า worker ทำงานอยู่
- Runtime ยังไม่มี event บอกลำดับคิว

## Decision

**Decision:** ให้ Controller ส่งข้อความขณะ busy ได้; Runtime ใช้คิวเดิม; UI แสดงข้อความว่าจะรอ Turn จบ

**Why:** Runtime มีคิวอยู่แล้ว การปิด Send ที่ Controller ทำให้ผู้ใช้ส่งงานล่วงหน้าไม่ได้และไม่ตรงกับ ADR 0011

**Rejected:** ตอบ `agent.busy` และให้ผู้ใช้ลองใหม่ — เสียโอกาสส่งงานล่วงหน้าและทำให้ผู้ใช้ต้องเฝ้า

**Open:** Queue position และ `task.queued` event จะทำพร้อม worker instrumentation ในรอบถัดไป

## Risks

- ผู้ใช้อาจเข้าใจว่าข้อความเริ่มทำงานทันที; ต้องข้อความ placeholder ให้ชัด
- ถ้า Runtime restart ข้อความในคิวอาจหาย; v0.1 ยังไม่persist คิว
