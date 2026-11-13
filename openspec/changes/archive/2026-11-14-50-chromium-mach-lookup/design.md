## Context

- profile เปิด mach-lookup เป็นรายชื่อ (#37) และตั้งใจไม่รวม Chromium
- เครื่องนี้มี Google Chrome และ Playwright Chromium หลายรุ่นใน cache
- มี denial watcher ที่เขียน `sandbox.denied` อยู่แล้ว

## Decisions

**วัดจากของจริง:** รัน Chrome/Chromium headless ใน worker sandbox (`--headless --dump-dom` หรือ Playwright screenshot) แล้วอ่าน `sandbox.denied` จาก Runtime log; เพิ่มเฉพาะ service ที่ปรากฏและจำเป็นต่อการเปิดหน้า/ถ่ายภาพ

**เหตุผลกำกับ:** เพิ่ม variant `Reason::Browser` และคอมเมนต์ว่ามาจาก Chromium/headless ไม่ใช่ OS

**ทดสอบ:** macOS-only test ที่หา browser จาก env; ถ้าไม่มีให้ skip พร้อมเหตุผล ไม่ทำให้ CI แดง; test ตรวจว่าได้ DOM, เขียน screenshot ได้, และ owner home ยังถูกปฏิเสธในกฎเดียวกัน

**ไม่ถอยกลับ:** ไม่มี `(allow mach-lookup)` เปิดทั้งหมด; service ที่ยังไม่รู้ให้เพิ่มจาก log ทีละตัว

## Risks

- Chromium รุ่นต่างกันขอ service ต่างกัน → วัดจากรุ่นที่มีและบันทึก; denial ของรุ่นอื่นจะเห็นใน log
- sandbox อาจปิด feature ของ browser (GPU, crashpad) → ใช้ headless mode ที่ลด service; ถ้าจำเป็นต้องเปิด service ที่กว้างเกิน ให้บันทึกและพิจารณา
- CI macOS อาจไม่มี browser → test skip; ต้องมีเครื่องจริงยืนยัน
