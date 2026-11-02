## Why

ทุก change ถัดไปของ v0.1 ต้องการข้อความระหว่าง Controller, Hub และ Runtime ที่ Hub ที่โดนเจาะปลอม เปลี่ยนทาง หรือส่งซ้ำไม่ได้ (ADR 0006, 0019) นี่คือ change แรกใน `docs/roadmap.md` และโค้ดของ Protocol ถูกลบใน `33deb1a` เพื่อเริ่มสร้างใหม่จากการออกแบบ

ของเดิมเป็นฐานที่ดี แต่เกิดก่อนการตัดสินใจสามข้อ คือรายชื่อผู้รับในหัวซอง (ADR 0034) และ error ที่เป็น code ไม่ใช่ประโยค (ADR 0065) อีกข้อคือของเดิมไม่เคยตรวจว่าซองส่งถึงผู้รับจริงไหม Hub จึงส่งซองที่เซ็นถูกต้องให้ Runtime ผิดเครื่องได้

## What Changes

- เพิ่ม `packages/protocol` โดยกู้จาก `33deb1a^` เฉพาะส่วนซองข้อความ ได้แก่การเซ็น การตรวจ base64url และ Ed25519
- เพิ่มรายชื่อ `recipients` ที่เป็นรหัส Member ในหัวซองและสำเนาที่เซ็น เป็นเส้นทางของข้อความที่ส่งถึง Controller
- เพิ่มการตรวจที่ปฏิเสธซองซึ่งเซ็นถูกต้องแต่ไม่ได้ส่งถึงผู้รับ
- เพิ่มข้อความชนิด `error` ที่มี code กับค่าประกอบ ไม่มีประโยคที่คนอ่าน
- เผยแพร่ JSON Schema ของหัวซองและ test vector ร่วม
- ต่อ package เข้ากับ workspace ที่ root, `bun run check`, `bun run test` และ CI
- ไม่รวมข้อความ handshake ของ Hub จาก package เดิม ซึ่งจะกลับมาพร้อม `hub-relay`

## Capabilities

### New Capabilities
- `protocol-envelope`: ซองที่เซ็นแล้วซึ่งใช้ส่งข้อความทุกชิ้นของ Veeloe สิ่งที่ผู้รับตรวจก่อนเชื่อ การข้ามสิ่งที่ไม่รู้จัก และรูปแบบของ error

### Modified Capabilities

ไม่มี `openspec/specs/` ยังว่างอยู่

## Impact

- **package ใหม่:** `packages/protocol` ซึ่ง Runtime และ Controller ใช้ผ่าน workspace (ADR 0025)
- **dependency ใหม่:** `@noble/curves` และ `zod` ตามเวอร์ชันที่ package เดิมตรึงไว้
- **เครื่องมือ:** `package.json`, `tsconfig.json` ที่ root และ `.github/workflows/ci.yml` ส่วน `AGENTS.md` แก้ตรงที่บอกว่ายังไม่มีโค้ดและตรงที่บอกว่าการตรวจครอบอะไร
- **change ถัดไป:** `hub-relay` สร้างหัวซองฝั่ง Go และ handshake บน schema กับ vector ที่เผยแพร่ ส่วน `controller-foundation` และ `machine-pairing` เพิ่มที่เก็บเลขลำดับแบบถาวรและกุญแจที่เชื่อ
