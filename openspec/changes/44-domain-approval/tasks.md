## 1. Turn context และ approval ที่ proxy

- [x] 1.1 supervisor เก็บ Turn ที่กำลังทำต่อ Agent จาก event turn.started/turn.ended
- [x] 1.2 proxy สร้าง `approval.requested` ของโดเมน (kind/domain/agent/task) และส่งถึง Member ที่มี Approve
- [x] 1.3 supervisor ดัก `approval.answer` ของ proxy ก่อนส่งต่อ worker; timeout/Stop ตัด connection
- [x] 1.4 `always` เพิ่มโดเมนเข้า Egress ของ Agent และเขียน log; ครั้งต่อไปไม่ถาม

## 2. Protocol และ Controller

- [x] 2.1 protocol (Rust + TS + vectors): `kind`/`domain` และ decision `always`
- [x] 2.2 Controller แสดงโดเมนและปุ่ม อนุญาตครั้งนี้/ถาวร/ปฏิเสธ พร้อม i18n
- [x] 2.3 test: ครั้งเดียว/ถาวร/ปฏิเสธ/สิทธิ์ไม่พอ/timeout

## 3. ตรวจ

- [x] 3.1 cargo test workspace + bun run check + e2e ผ่านบน macOS
- [ ] 3.2 Linux CI ผ่าน — Docker บนเครื่องนี้เริ่มไม่ขึ้นเพราะดิสก์เต็ม (ดูรายงาน) ให้ CI `ubuntu-latest` เป็นผู้ยืนยัน
