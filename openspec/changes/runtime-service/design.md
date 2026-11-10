## Context

- `packages/runtime/crates/runtime-supervisor/src/main.rs` เป็น CLI และ supervisor
- `runtime_home()` ใช้ `VEELOE_HOME` หรือ `~/.veeloe`
- `load_trust(home)` บอกว่าเครื่อง pair แล้วหรือยัง
- ยังไม่มี service module; Runtime ต้องรันใน terminal

## Terminology

- **Service** คือ process ที่ OS ดูแลให้เริ่มตอน login/boot และ restart เมื่อตาย
- **LaunchAgent** คือ service ระดับผู้ใช้ของ macOS
- **Systemd user unit** คือ service ระดับผู้ใช้ของ Linux
- **Service log** คือไฟล์ `<VEELOE_HOME>/runtime/logs/service.log` ที่ stdout/stderr ของ service ไปลง

## Decisions

### 1. ใช้ service ระดับผู้ใช้ ไม่ใช่ system-wide

**Decision:** macOS ใช้ LaunchAgent ใน `~/Library/LaunchAgents`; Linux ใช้ systemd user unit ใน `~/.config/systemd/user`

**Why:** Runtime ทำงานในนามเจ้าของเครื่องและเข้าถึง Workdir/Provider key ของผู้ใช้; system-wide service จะต้องจัดการ user/permission เพิ่มและเสี่ยงเกินไป

**Rejected:** LaunchDaemon/system systemd — ต้อง root และแยก user context

### 2. เก็บ `VEELOE_HOME` ไว้ใน service definition

**Decision:** ตอน install อ่าน home ปัจจุบันและเขียนเป็น environment ใน plist/unit; ตอน uninstall ใช้ label/unit เดิม

**Why:** ถ้า service เริ่มด้วย default `~/.veeloe` แต่ผู้ใช้ทดสอบด้วย `VEELOE_HOME` อื่น จะได้คนละ trust/key

**Rejected:** ให้ service อ่าน environment จาก shell — service ไม่ได้เริ่มจาก shell เดียวกัน

### 3. ต้อง pair ก่อนติดตั้ง

**Decision:** `service install` ตรวจ `trust.owners` ไม่ว่าง; ถ้าว่างให้ error บอกให้ `veeloe pair` ก่อน

**Why:** service ที่ยังไม่ pair จะรันแล้ว prompt ใน noninteractive context หรือ restart วน

### 4. Log ของ service ไปที่ไฟล์เดียว

**Decision:** stdout/stderr ของ service ไปที่ `<home>/runtime/logs/service.log`; สร้างโฟลเดอร์ตอน install

**Why:** launchd/systemd ไม่มี terminal; ถ้าไม่เก็บ log จะdebug ไม่ได้

## API / CLI

```text
veeloe service install
veeloe service uninstall
```

- `install`: เขียน unit/plist, โหลด, เปิดใช้งาน
- `uninstall`: หยุด, ลบ unit/plist, ไม่ลบข้อมูล
- ไม่มี `service status`; ใช้ `veeloe status` และ `launchctl`/`systemctl` ของ OS

## Risks

- `launchctl bootstrap`/`systemctl --user` ล้มเหลวถ้า environment ไม่มี session; ต้องรายงานคำสั่งที่ใช้
- Executable path อาจเป็น `target/debug/veeloe` ตอน dev; service จะชี้ไปที่ path นั้นจนกว่าจะ build/install ใหม่
- macOS Sleep/Lid close ยังหยุด process; service ไม่ได้กัน sleep

## Open decisions

- จะเพิ่ม `service status` หรือ `service logs` ในอนาคตหรือไม่
