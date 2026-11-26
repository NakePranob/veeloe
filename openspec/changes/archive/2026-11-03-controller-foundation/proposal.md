## Why

`protocol-envelope` กับ `hub-relay` จบแล้ว แต่ยังไม่มี Controller ตัวจริง ทุก change ถัดไปในเส้นทางแรกต้องวางบนแอปตัวนี้ และ `controller-prototype` เอามาต่อไม่ได้ เพราะเป็นของทิ้งที่รันบนข้อมูล Demo และเขียนข้อความลงหน้าจอตรงๆ

ทางเดินข้อมูลและระบบข้อความเป็นเรื่องที่แก้ทีหลังแล้วต้องไล่แก้ทุกหน้าจอ จึงต้องวางก่อนมีหน้าจอจริง (ADR 0021, 0065) ส่วนกุญแจแยกไปอยู่ใน `controller-device-key` เพราะต้องลองบน iPhone จริงก่อน archive และไม่ควรให้งานส่วนนี้ต้องรอ

## What Changes

- สร้างแอปใหม่ใน `controller/` ด้วย Expo Router และ Feature-Sliced Design พร้อม Steiger ใน `check` (ADR 0021, 0022)
- ฐานข้อมูลบนเครื่องที่หน้าจออ่านแบบ live รวม migration, การแจ้งครั้งเดียวต่อ commit และกติกาบนเว็บ ได้แก่ เปิดได้ทีละแท็บ และขอพื้นที่ถาวร (ADR 0021)
- **แก้ ADR 0021:** เมื่อเปิดฐานข้อมูลไม่ได้ เช่น ในหน้าต่างส่วนตัวของ Safari แอปแสดงหน้าแจ้งแทนการใช้ database ในหน่วยความจำ เพราะ `expo-sqlite` รุ่นนี้ทำแบบนั้นไม่ได้
- ระบบข้อความไทยกับอังกฤษ พร้อม key ที่ตรวจด้วย type, CI ที่ตรวจว่าสองภาษาครบ, การเปลี่ยนภาษาต่อเครื่อง และการแปล code จาก Protocol (ADR 0065)
- หน้าจอเท่าที่ทำให้ทั้งหมดนี้ลองได้จริง ได้แก่ หน้าแรกที่ยังว่าง หน้าตั้งค่าภาษา หน้า "ใช้ที่นี่" บนเว็บ และหน้าแจ้งเมื่อเปิดฐานข้อมูลไม่ได้

## Capabilities

### New Capabilities
- `controller-local-data`: ข้อมูลลงเครื่องก่อนและไหลถึงหน้าจออย่างไร รวมถึงกติกาบนเว็บ
- `controller-i18n`: ข้อความเลือกภาษา ถูกตรวจว่าครบ และแปล code จาก Protocol อย่างไร

### Modified Capabilities

ไม่มี change นี้ยังไม่ส่งอะไรผ่าน Hub

## Impact

- **โค้ดใหม่:** `controller/` และเพิ่มเข้า workspace ที่ root
- **Dependency ใหม่:** `expo-sqlite`, `expo-localization` และ `i18next` โดยใช้ Expo SDK 58 รุ่นเดียวกับ prototype
- **เครื่องมือ:** `check` และ `test` ที่ root ครอบ `controller/` เพิ่มการตรวจ key ของข้อความ และ CI รันด้วย
- **เอกสาร:** ADR 0021, `AGENTS.md`, `docs/roadmap.md` และเพิ่ม `controller/AGENTS.md`
- **change ถัดไป:** `controller-device-key` เพิ่มกุญแจและหน้าล็อก, `machine-pairing` เพิ่มการต่อ Hub และ `agent-and-task` เพิ่มตาราง event กับการ sync
