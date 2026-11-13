## 1. วัด service

- [x] 1.1 รัน Chrome/Chromium headless ใน sandbox และเก็บ `sandbox.denied`
- [x] 1.2 เพิ่ม service ที่จำเป็นพร้อม Reason::Browser และคอมเมนต์
- [x] 1.3 รันซ้ำจนเปิดหน้า/print DOM ได้โดยไม่มี denial ที่จำเป็น

**ผลวัด (macOS 27.0.1, Chrome for Testing 156 `chrome-headless-shell`):** profile
ไม่ต้องเพิ่ม service ของระบบเลย. สิ่งเดียวที่ขาดคือชื่อ Mach ที่ browser ลงทะเบียน
ให้ลูกของตัวเอง `<bundle>.MachPortRendezvousServer.<pid>` ซึ่งมี pid อยู่ด้วย จึง
ระบุเป็น regex เฉพาะ namespace ของ `com.google.Chrome` และ `org.chromium.Chromium`
และต้องอนุญาตทั้ง `mach-register` (ตัว browser) กับ `mach-lookup` (process ลูก).
denial ที่เหลือ (`com.apple.diagnosticd`, `windowserver.active`, `tccd.system`,
`pasteboard.1`, `SystemConfiguration.configd`, preference ของเจ้าของ) ถูกปฏิเสธ
แล้ว browser ยัง print DOM ได้ จึงไม่เพิ่ม.

`/Applications/Google Chrome.app` รัน headless ไม่ได้ใต้ profile นี้: มันลงทะเบียน
กับ Launch Services และเปิด NSWindow จริง แล้ว segfault เมื่อ `windowserver.active`,
`CARenderServer`, `windowmanager.server` และ `tccd.system` ถูกปฏิเสธ. ทางที่ใช้คือ
`chrome-headless-shell` ซึ่งอยู่ในโฟลเดอร์ของ Agent ไม่ใช่ `/Applications`.

## 2. Test และเอกสาร

- [x] 2.1 test macOS-only เปิด browser จริง (skip ถ้าไม่มี) และตรวจ DOM/ภาพ
- [x] 2.2 อัปเดต ADR/ข้อความที่บอกว่า Chromium ยังไม่อยู่
- [ ] 2.3 cargo test + CI ผ่าน

test ใช้ `VEELOE_TEST_BROWSER` ชี้ไปที่ `chrome-headless-shell`; ไม่ได้ตั้งค่าจะ
skip พร้อมข้อความ. ตัว test คัดลอก browser เข้าโฟลเดอร์ของ Agent (sandbox ไม่เคย
อ่าน cache/home ของเจ้าของ) แล้วสั่ง `--dump-dom` และยืนยันว่า `ls $HOME` ของ
เจ้าของยังถูกปฏิเสธในกฎเดียวกัน. CI macOS ที่ไม่มี browser จะ skip.
