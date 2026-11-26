## Why

Runtime ต้องรันค้างเพื่อรับงานจาก Controller แต่ตอนนี้ผู้ใช้ต้องเปิด terminal แล้วรัน `veeloe` เอง ถ้าปิด terminal หรือ reboot เครื่อง Agent จะหยุดทำงาน v0.1 ต้องมีวิธีติดตั้ง Runtime เป็น service ของระบบ เพื่อให้ Agent ทำงานต่อได้โดยไม่ต้องมีคนเฝ้า

## What Changes

- เพิ่มคำสั่ง `veeloe service install` และ `veeloe service uninstall`
- macOS: เขียน LaunchAgent `dev.veeloe.runtime` ใน `~/Library/LaunchAgents` แล้ว bootstrap เข้า `gui/$UID`
- Linux: เขียน systemd user unit `veeloe.service` ใน `~/.config/systemd/user` แล้ว `enable --now`
- Service ใช้ executable ปัจจุบันและ `VEELOE_HOME` ปัจจุบัน; stdout/stderr ไปที่ `<home>/runtime/logs/service.log`
- ติดตั้งได้เฉพาะเครื่องที่ pair แล้ว; ถ้ายังไม่ pair ให้บอกให้ pair ก่อน
- uninstall หยุด service และลบ unit/plist โดยไม่แตะข้อมูล Agent

## Capabilities

### New Capabilities

- `runtime-service`: การติดตั้ง/ถอน Runtime เป็น service ของ macOS และ Linux

### Modified Capabilities

- `runtime-cli`: เพิ่มคำสั่ง `service`

## Non-goals

- Windows service
- Self-update หรือ restart ระหว่าง Turn (ADR 0009/0033)
- ติดตั้งเป็น system-wide service (`/Library/LaunchDaemons` หรือ system systemd)
- สร้าง GUI สำหรับติดตั้ง service

## Impact

- **Runtime:** module `runtime-supervisor/src/service.rs`, CLI dispatch/help, tests ของ plist/unit
- **Dependency:** ใช้ `launchctl` บน macOS และ `systemctl --user` บน Linux ที่มีอยู่
- **ข้อมูล:** service ใช้ `VEELOE_HOME` เดิม; ไม่ย้ายหรือลบข้อมูล

## Acceptance anchor cases

- Mac ที่ pair แล้ว: `veeloe service install` สร้าง LaunchAgent และ Runtime ทำงานหลังปิด terminal
- Linux ที่ pair แล้ว: `veeloe service install` สร้าง systemd user unit และ `systemctl --user status veeloe` แสดง active
- เครื่องที่ยังไม่ pair: install ถูกปฏิเสธพร้อมบอกให้ pair ก่อน
- `veeloe service uninstall` หยุด service และลบ unit แต่ Workdir/Agent/Task ยังอยู่
