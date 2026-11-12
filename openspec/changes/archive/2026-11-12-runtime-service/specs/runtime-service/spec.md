# Spec Delta

## Purpose

กำหนดการติดตั้ง Runtime เป็น service ระดับผู้ใช้บน macOS และ Linux เพื่อให้ Agent ทำงานต่อหลังปิด terminal หรือ login ใหม่

คำศัพท์: **Service** คือ process ที่ OS ดูแล; **LaunchAgent** คือ service ผู้ใช้ของ macOS; **Systemd user unit** คือ service ผู้ใช้ของ Linux; **Service log** คือ `<VEELOE_HOME>/runtime/logs/service.log`

## ADDED Requirements

### Requirement: ติดตั้ง Runtime เป็น service ของผู้ใช้
`veeloe service install` SHALL ติดตั้ง Runtime เป็น service ระดับผู้ใช้โดยใช้ executable และ `VEELOE_HOME` ปัจจุบัน; macOS MUST ใช้ LaunchAgent label `dev.veeloe.runtime`; Linux MUST ใช้ systemd user unit `veeloe.service`; service MUST เริ่มอัตโนมัติเมื่อ login และ restart เมื่อ process ตาย

#### Scenario: ติดตั้งบน macOS
- **WHEN** ผู้ใช้ที่ pair แล้วรัน `veeloe service install` บน macOS
- **THEN** มี LaunchAgent `dev.veeloe.runtime` ที่ชี้ executable และ `VEELOE_HOME` ปัจจุบัน และ Runtime ทำงานหลังปิด terminal

#### Scenario: ติดตั้งบน Linux
- **WHEN** ผู้ใช้ที่ pair แล้วรัน `veeloe service install` บน Linux
- **THEN** มี systemd user unit `veeloe.service` ที่ enabled และ active

#### Scenario: ยังไม่ pair
- **WHEN** ผู้ใช้รัน `veeloe service install` บนเครื่องที่ยังไม่มี Owner ใน trust
- **THEN** คำสั่งปฏิเสธและบอกให้ `veeloe pair` ก่อน

### Requirement: Service ใช้ home และ log เดิม
Service MUST ใช้ `VEELOE_HOME` เดิมและเขียน stdout/stderr ไปที่ `<home>/runtime/logs/service.log`; การติดตั้ง MUST NOT ย้ายหรือลบ Agent, Workdir, Task หรือ trust

#### Scenario: Home แยก
- **WHEN** ผู้ใช้ติดตั้งด้วย `VEELOE_HOME=/tmp/veeloe-test`
- **THEN** service ใช้ `/tmp/veeloe-test` และ log อยู่ใต้ home นั้น

### Requirement: ถอน service โดยไม่ทำลายข้อมูล
`veeloe service uninstall` SHALL หยุด service และลบ LaunchAgent/systemd unit; MUST NOT ลบ Agent, Workdir, Task, trust หรือ Provider

#### Scenario: ถอนบน macOS
- **WHEN** ผู้ใช้รัน `veeloe service uninstall`
- **THEN** LaunchAgent ถูก bootout และไฟล์ plist ถูกลบ แต่ข้อมูลใต้ `VEELOE_HOME` ยังอยู่

#### Scenario: ถอนบน Linux
- **WHEN** ผู้ใช้รัน `veeloe service uninstall`
- **THEN** unit ถูก disable/stop และไฟล์ unit ถูกลบ แต่ข้อมูลใต้ `VEELOE_HOME` ยังอยู่
