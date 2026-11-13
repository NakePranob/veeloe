## Why

issue #50: Agent รัน headless browser ใน sandbox ยังไม่ได้ เพราะรายชื่อ mach-lookup ไม่มี service ของ Chromium (ตั้งใจเลื่อนไว้ใน #37) งาน QA หน้าเว็บของ Agent จึงทำไม่ได้

## What Changes

- วัด service ที่ Chrome/Playwright Chromium ต้องใช้บน macOS 27 จากการรันจริงใน sandbox
- เพิ่ม service เหล่านั้นเข้า `MACOS_SERVICES` ทีละตัวพร้อมเหตุผล (`browser`)
- test ที่เปิด headless browser จริงใน sandbox แล้ว print DOM/screenshot; ข้ามถ้าเครื่องไม่มี browser
- แก้เอกสาร/ADR ที่บอกว่า Chromium ยังไม่อยู่ในรายการ

## Capabilities

### Modified Capabilities

- `runtime-sandbox`: mach-lookup ของ macOS รวม service ของ headless browser

## Impact

- runtime-core: รายการ service + เหตุผล
- test: macOS-only real browser test
- เอกสาร: ADR/ข้อความที่เคยบอกว่ายังไม่รวม Chromium
