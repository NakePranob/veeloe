# keel คุมโครงสร้างแทน Steiger และ go-scaffold

Status: accepted
Tools: bun 1.3.14, Go 1.25, cargo (workspace เดิม), checked 2026-11-16 from the repo

แก้ ADR 0022 (ตัวตรวจของแต่ละส่วน, slice ของ supervisor) และ ADR 0014 (go-scaffold และ `check` ของมัน)

ตัวตรวจโครงสร้างเดิมคุมได้ไม่ครบและเป็นของคนละเจ้า Steiger มองไม่เห็น `export … from` และไม่ตรวจ import ลึกเข้า `shared` (เจอสามที่เข้า `shared/lib/days`) `go-scaffold check` ผูก Hub ไว้กับ generator และกฎ depguard ต่อ domain ใน `.golangci.yml` ไม่รวม module `controller` และ CI ก็ไม่ได้รัน ส่วน dependency-cruiser ที่ ADR 0022 ให้ใช้กับ Runtime เป็นเครื่องมือฝั่ง JS และไม่เคยมีอยู่จริง

**การตัดสินใจ:** โครงของทุกส่วนยังเหมือนเดิม Controller เป็น FSD, Hub เป็น module แบบ hexagonal และ Runtime แยก crate แต่ที่บันทึกข้อตกลงและตัวตรวจเปลี่ยนเป็น keel แต่ละส่วนมี `.conventions/rules.json` ของตัวเอง (`controller/`, `hub/`, `packages/` สำหรับ Runtime เพราะ workspace build คู่กับ `packages/protocol`, และ root สำหรับกฎ git) กฎทุกข้อมีไฟล์ที่ต้องถูกปฏิเสธและไฟล์ที่ต้องผ่าน และ `prove.py` พิสูจน์ว่าตัวตรวจจับได้จริง ตัวตรวจเขียนด้วยภาษาของส่วนนั้นและไม่เพิ่ม dependency ได้แก่ `controller/scripts/check-structure.ts`, `hub/internal/archtest` และ test `structure` ใน `runtime-core` ทั้งหมดรันใน `bun run check:structure` และทุกข้อพิมพ์ rule id กับชื่อไฟล์เมื่อไม่ผ่าน template ของ unit ใหม่อยู่ใน `.conventions/templates/` ซึ่ง copy มาจาก unit จริง (`pages/usage`, `entities/task`, `machine`, `relay`) แยกจาก unit จริงเพื่อให้โฟลเดอร์ที่เพิ่มเข้าไปใน unit ไม่กลายเป็นส่วนหนึ่งของ template ไปด้วย prototype ไม่มีตัวตรวจโครงสร้าง เพราะเป็นของทิ้ง

(ADR 0071 แก้ส่วนนี้: supervisor แยก `messages/` กับ `cli/` แล้ว และ `packages/.conventions/` คุม protocol กับ rustfmt ด้วย) supervisor เป็น module แบนใน crate เดียวที่ `use crate::…` ถึงกันได้ ไม่ได้แบ่งเป็น slice ตามที่ ADR 0022 วางไว้ ADR นี้บันทึกตามโค้ดจริง ส่วนการแยก `dispatch` ใน `tasks.rs` ตามชนิดข้อความเป็นงาน refactor แยกต่างหาก กฎที่ยังไม่มีตัวตรวจ เช่นแกนของ worker ที่ปลอด IO ถูกบันทึกเป็น `proseOnly` ใน `rules.json`

## Considered Options

- **dependency-cruiser หรือ eslint-plugin-boundaries ใน Controller:** เป็นเครื่องมือที่คนรู้จัก แต่เพิ่ม dependency และต้องตั้ง resolver ก่อนจะเห็น `.ts` ส่วน script สั้น ๆ ใช้ bun ที่มีอยู่แล้ว
- **depguard ใน golangci-lint ของ Hub:** มีอยู่แล้ว แต่ต้องเขียนกฎทีละ module จึงล้าสมัยทุกครั้งที่เพิ่ม module (`controller` ตกหล่นไปแล้ว) และ CI ไม่ได้รัน
- **เก็บ Steiger ไว้คู่กับ keel:** ได้กฎ FSD ครบชุดของ Steiger แต่ต้องดูแลตัวตรวจสองชุดที่กฎทับกัน

## Consequences

- เพิ่ม unit ด้วย `/keel:add-unit` แก้ unit ด้วย `/keel:change-unit` และไม่ใช้ `go-scaffold generate` อีกต่อไป
- template เป็นสำเนา จึงห่างจากโค้ดจริงได้ เมื่อโครงของ unit เปลี่ยน ให้แก้ template ใน commit เดียวกัน
- เอกสารใน `hub/docs/architect/` ที่ go-scaffold เขียนยังอยู่ และมีหมายเหตุบอกว่าใช้ template แทน CLI
