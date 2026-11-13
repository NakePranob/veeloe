## Why

issue #45: Runtime เก็บ Egress ต่อ Agent แล้ว (#43) แต่หน้า Machines ยังแก้แบบเหมารวมทุก Agent ทำให้ Owner ตั้ง Egress ต่างกันต่อ Agent จากแอปไม่ได้

## What Changes

- Controller เก็บ Egress ของ Agent แต่ละตัวจาก `agent.listed` ลง DB local
- Egress section เลือก Agent ได้ และเพิ่ม/ลบโดเมนของ Agent นั้น (`egress.set` พร้อม `agent`)
- ตัวเลือก "ทุก Agent" แบบเดิมยังอยู่ (ไม่ส่ง agent)
- i18n ไทย/อังกฤษ

## Capabilities

### Modified Capabilities

- `machine-egress`: การแก้ Egress ต่อ Agent จาก Controller

## Impact

- Controller: entity Agent, migration, machine-link model, EgressSection, i18n, tests
- ไม่แตะ Runtime/Hub
