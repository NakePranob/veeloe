# งานเชิงรุกเข้า harness ผ่าน trigger ภายในที่ supervisor สร้าง ไม่ใช่การ replay ซองที่เซ็นแล้ว

Schedule, Idle Work และ Watch (ADR 0027, 0056, 0057) ต้องเปิด Turn โดยไม่มี Member พิมพ์ข้อความใหม่ แต่ `ToWorker::Message` ของ harness วันนี้ต้องมี `member`, `id`, `text` และ `reference` ของซองที่เซ็นแล้ว พร้อม seen-sequence กัน replay (ADR 0012, 0019) การเอา envelope เดิมที่เซ็นครั้งเดียวมา replay ทุกรอบจึงชนกับกลไกนั้นและเปิดช่อง replay

เราจึงให้ **supervisor แปลง trigger ที่เซ็นและเก็บไว้บน Machine เป็น trigger ภายในชนิดใหม่** (แนว `ToWorker::Run`) ที่มี `{ task, member, trigger: { kind: "schedule" | "idle" | "watch", id, at }, text }` แล้วส่งให้ worker ตามลูปเดิม worker ไม่ตรวจ signature ของ trigger ต่อรอบ เพราะถือ supervisor ที่ตรวจตอนรับ/โหลดและตรวจการถอนกุญแจแล้ว แต่ `turn.started` ต้องบันทึก `trigger`, `member` และ `at` ไว้ เพื่อให้ย้อนดูได้ว่ารอบนั้นมาจากอะไร และเพื่อให้ยกเลิก/ระงับ trigger เมื่อกุญแจที่เซ็นถูกถอน (ADR 0031) ได้ก่อนรอบถัดไป

เหตุผลคือรักษาหลัก "ไม่มีงานที่ไม่มีใครเซ็น" โดยไม่ผูกการทำงานเข้ากับการ replay ซอง และทำให้ทุก trigger ใช้ harness เดียวกันแทนการแยกโค้ดต่อชนิด ซึ่งจะทำให้พฤติกรรมของ Turn (Stop, Approval, Budget, Memory, compaction) แตกเป็นสามชุด

## Considered Options

- **ขอ envelope ใหม่จาก Controller ทุกครั้งที่ถึงรอบ**: ตรวจ signature สด ๆ ได้ แต่ Machine ต้องออนไลน์ถึง Hub และ Controller ต้องออนไลน์ด้วย ซึ่งขัดกับ ADR 0027 ที่บอกว่า Runtime ทำงานเองได้ในเครื่อง; ถ้า Controller ปิดอยู่ Schedule จะไม่ทำงาน
- **แยก harness ต่อ trigger (Schedule/Idle/Watch คนละลูป)**: เขียนง่ายต่อชนิด แต่ต้องทำ Stop, Approval, Budget, Memory และ compaction ซ้ำสามชุด และพฤติกรรมจะเพี้ยนกันเมื่อแก้ข้างเดียว
- **ใช้ heartbeat ที่ Agent ตื่นเองโดยไม่มีข้อความ**: ไม่มี Member เจ้าของงาน ขัด ADR 0010 และไม่รู้ว่าตรวจ Use ของใคร (ADR 0027)
- **ให้เหตุการณ์จากภายนอกเริ่ม Turn ทันที**: เร็วกว่า แต่ข้อความภายนอกกลายเป็นผู้เริ่มงาน เปิดช่อง prompt injection (ADR 0003) และต้องผ่าน Hub ซึ่งเห็นเนื้อใน (ADR 0005)

## Consequences

- Trigger ที่เซ็นแล้วต้องเก็บบน Machine พร้อมเจ้าของ (Member), เวลาที่ควรเริ่ม, ชนิด และรหัส เพื่อให้ supervisor สร้าง `ToWorker::Run` ได้แม้ Hub/Controller ออฟไลน์
- การถอนกุญแจต้องลบหรือระงับ trigger ที่กุญแจนั้นเซ็นก่อนรอบถัดไป ไม่ใช่แค่ปฏิเสธตอนเริ่ม Turn
- `turn.started` มีข้อมูลเพิ่ม จึงต้องคงความเข้ากันได้กับ Task ที่มีอยู่ (field ใหม่แบบ optional) และ Controller รุ่นเก่าต้องไม่พัง
- **ยังไม่ได้ตัดสินใน ADR นี้** และต้องปิดก่อน implement: การจบ Turn แบบไม่แจ้งใครและ Task ไม่ขึ้น Inbox, การข้ามรอบเมื่อ Agent ไม่ว่าง, Approval ใน Turn ที่ไม่มีคนอยู่, เพดานเวลาของ Idle Work, catch-up ตอนเปิดเครื่อง, source และเพดาน 30% ของ Idle+Watch (ADR 0043, 0066), การรวม event ของ Watch, และ Task/visibility ของงานที่ไม่มี Member ส่งข้อความ (ADR 0060) — บันทึกเป็น checklist ใน `docs/roadmap.md` แล้ว
