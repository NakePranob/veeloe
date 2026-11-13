# สิ่งที่ยังไม่เคยทดสอบจริง

อัปเดต: 2026-11-13

ไฟล์นี้รวมช่องว่าง QA ที่ยังไม่ได้ปิด พร้อมวิธีทดสอบและสิ่งที่ต้องมีก่อนทดสอบ
เก็บไว้คู่กับ issue #32/#31; เมื่อปิดข้อไหนให้ติ๊กและใส่หลักฐาน (คำสั่ง, run id, ภาพ)

## Linux

### 1. Ubuntu 24.04 ที่ AppArmor จำกัด user namespace (ยังไม่ทดสอบจริง)

- สถานะ: ยังไม่เคยรันบนเครื่องที่ `kernel.apparmor_restrict_unprivileged_userns=1`
- ที่ทำแล้ว: unit test ด้วย probe ปลอม, CI เคส `bwrap` ขาด (Linux runner ปิด restriction ให้ job)
- ต้องมี: Ubuntu 24.04 ค่า default (restriction=1) หรือ VM
- ขั้นตอน:
  1. รัน `veeloe` แล้วตรวจข้อความ preflight ว่า names ไฟล์/ค่า และแนะนำ `bwrap-userns-restrict` (ไม่ใช่ปิดทั้งเครื่อง)
  2. ทำตามข้อความ (คัดลอก profile + `apparmor_parser -r`) แล้วรันใหม่
  3. ตรวจว่า supervisor เริ่มได้, worker ขึ้น `ready`, e2e sandbox ผ่าน
- หลักฐานที่ต้องเก็บ: ข้อความก่อน/หลังแก้, `aa-status` หรือ sysctl value, ผลรัน

### 2. Linux จริงบนเครื่องผู้ใช้ (ไม่ใช่ CI/Docker)

- สถานะ: ยังไม่เคย QA บน distro/systemd/network จริง
- ที่ทำแล้ว: privileged Ubuntu 24.04 Docker และ CI `ubuntu-latest`
- ต้องมี: เครื่อง Linux หรือ VM ที่ผู้ใช้ถือ
- ตรวจ: ติดตั้ง, pair, รัน Agent หนึ่งงาน, Egress/approval, dev server บน `PORT`, `bun install`
- หมายเหตุ: Docker บน macOS ใช้ kernel ของ VM ไม่ใช่ kernel เครื่องจริง

### 3. systemd cgroup v2 resource limits

- สถานะ: implement แล้ว (#48) แต่ยังไม่เคยเปิด scope จริงบนเครื่องที่มี user systemd
- ที่ทำแล้ว: argv/fallback/fake-/proc + fallback บน Linux Docker/CI
- ต้องมี: เครื่อง Linux ที่มี `systemd --user` เพื่อยืนยัน MemoryMax/CPUQuota/TasksMax จริง
- ตรวจ: `MemoryMax`, `CPUQuota`, `TasksMax` มีผลกับ worker; คำสั่งที่กินเกินถูกฆ่า

### 4. AppArmor profile ของ Veeloe (ไฟล์ + installer)

- สถานะ: **ยังไม่ implement** — ข้อความ preflight อ้าง profile ที่ Ubuntu ให้มา
- ต้องมี: Ubuntu 24.04 ที่ restriction=1
- ตรวจ: ติดตั้ง profile แล้ว bwrap สร้าง userns ได้โดยไม่ปิดทั้งเครื่อง

## macOS

### 5. Resource limits (RLIMIT_CPU / RSS)

- สถานะ: implement แล้ว (#47) และมี test จริงเรื่อง RLIMIT/RSS; ยังไม่เคยทดสอบ worker เต็มตัวที่ใช้ CPU ถึง limit (ต้อง 30 นาที)
- ตรวจ: worker ที่ busy loop ถูกตัดตาม CPU time; worker ที่กิน RAM เกินถูก supervisor ฆ่าและรายงาน

### 6. mach-lookup ของ Chromium / headless browser

- สถานะ: **ยังไม่ implement** — รายชื่อ service ของ Chromium ยังไม่อยู่ใน profile
- ตรวจ: เปิด headless browser ใน sandbox ได้, screenshot หน้าเว็บ, ไม่มี denial ที่จำเป็น
- ต้องมี: Chromium/Playwright ที่ติดตั้งในเครื่องทดสอบ

### 7. service ของเจ้าของเครื่องในช่วง port ของ Agent

- สถานะ: ข้อจำกัด Seatbelt ที่ `localhost` อาจกว้างกว่า loopback (ADR 0069)
- ตรวจ: เปิด service ของ host ใน port ที่อยู่ในช่วงของ Agent แล้วดูว่า Agent ต่อได้หรือไม่; ยืนยันว่ายังไม่หลุดพ้นช่วง port

## ฟีเจอร์ที่ยังไม่ implement (ไม่ใช่แค่ยังไม่ทดสอบ)

### 8. git broker (clone/fetch/push repo private)

- สถานะ: **ยังไม่ implement** — ต้องมี GitHub App/credential ก่อน
- ตรวจ: `git clone` repo private, push branch ที่อนุญาต, ถูกปฏิเสธ force-push/main/tag, token อายุสั้น, ไม่มี key ใน sandbox

### 9. Approval คำสั่งแบบ "Tell it what to do instead"

- สถานะ: UI มีปุ่ม แต่ยังไม่เคยทดสอบ flow นี้ในแอปจริง
- ตรวจ: กดแล้วส่งข้อความแทนคำสั่ง, คำสั่งเดิมไม่รัน, LLM ได้คำแนะนำนั้น

## แอป/อุปกรณ์

### 10. iPhone จริง (#31)

- สถานะ: ยังไม่เคยรันบนเครื่องจริง; QA ทั้งหมดใช้ simulator
- ตรวจ: pair, Task, approval, Egress picker, background/foreground, push (ถ้าเปิด)

### 11. Android

- สถานะ: ยังไม่เคยทดสอบ (ถ้าจะรองรับ)

### 12. UI บนจอจริง/ฟอนต์ไทย

- สถานะ: simulator ผ่าน; ยังไม่ตรวจบนอุปกรณ์จริง ขนาดจอ/ฟอนต์/คีย์บอร์ด

## กระบวนการ

### 13. Reviewer ย้อนหลังของ #39/#40/#41

- สถานะ: ไม่มี reviewer (self-review เท่านั้น) — เป็น bug fix ที่แตะ security/e2e
- ทางเลือก: ส่ง diff ย้อนหลังให้ reviewer หรือบันทึกเหตุผลว่าไม่จำเป็น

### 14. Egress transition: Controller ใหม่ ↔ Runtime เก่า

- สถานะ: design ระบุว่า `agent` ถูกเมินและกลายเป็นแก้ทุก Agent; ยังไม่เคยลองของจริง
- ตรวจ: ต่อ Controller ใหม่กับ Runtime ก่อน #43 แล้วดูว่า UI/behavior ตรงตามที่เตือน

### 15. Per-Agent proxy port ชนกับช่วง port ที่จองทีหลัง

- สถานะ: วิเคราะห์แล้วว่าเป็นไปได้เฉพาะช่วงแคบ (dev-server bind conflict) แต่ยังไม่มี test
- ตรวจ: สร้าง Agent ใหม่ขณะ proxy ทำงาน แล้วยืนยันว่าไม่ทับ port ที่ proxy ใช้
