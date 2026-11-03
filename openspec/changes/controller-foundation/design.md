## Context

repo ยังไม่มี Controller ตัวจริง `controller-prototype/` ใช้ Expo SDK 58, Expo Router และ FSD อยู่แล้ว แต่เป็นของทิ้ง และไม่มี db หรือ i18n

ตัวอย่าง UI กับ token มาจาก design system ตาม `controller-prototype/AGENTS.md` และ root ใช้ bun แบบ `linker = "hoisted"` เพื่อให้ Metro เห็น `node_modules` แบบแบน

## Goals / Non-Goals

**Goals:**
- วางสองเรื่องที่ทุกหน้าจอต้องพึ่ง โดยไม่ต้องกลับมาแก้เมื่อหน้าจอจริงมา
- ลองทั้งหมดได้จริงบน iOS และเว็บ ด้วยหน้าจอน้อยที่สุด

**Non-Goals:**
- กุญแจและหน้าล็อกอยู่ใน `controller-device-key`
- การต่อ Hub, protocol client และ handshake อยู่ใน `machine-pairing`
- ตาราง event, การ sync และ Mood อยู่ใน `agent-and-task` และ `controller-task-screens`
- Demo Workspace อยู่ใน v0.3 ตาม ADR 0048
- EAS และการแจกแอป ใช้ `expo run:ios` ไปก่อน

## Decisions

### ตัวกั้นแทนที่เนื้อหาแทนการเปลี่ยน route

`src/app` มีตัวกั้นตัวเดียว เมื่อแท็บนี้ไม่ได้ถือฐานข้อมูล จะ render หน้า "ใช้ที่นี่" แทน `<Stack />` URL จึงไม่เปลี่ยน `controller-device-key` เพิ่มสถานะกุญแจเข้ามาที่จุดเดียวกันนี้ และลิงก์หรือ push ที่เปิดหน้า Approval ในอนาคตจะกลับมาหน้านั้นได้โดยไม่ต้องจำปลายทางเอง

### ทุกการอ่านและเขียนเข้าคิวเดียวบน connection เดียว

`withExclusiveTransactionAsync` ไม่มีบนเว็บ และ `withTransactionAsync` ปล่อยให้ query อื่นบน connection เดียวกันเห็นแถวที่ยังไม่ commit `shared/db` จึงส่งทุกการอ่านและเขียนผ่าน promise chain เดียว โค้ดทางเดียวจึงใช้ได้ทุก platform ราคาคือการอ่านต้องรอ batch ที่เขียนอยู่ ใส่ `ponytail:` comment ไว้ว่าถ้าวัดแล้วช้า ให้เพิ่ม connection อ่านแยกบนมือถือ

### แจ้งหน้าจอจาก `write()` แทน change listener

ADR 0021 บอกว่า change event ยิงทีละแถวและยิงก่อน commit ผู้เขียนทุกคนจึงเรียก `write(topics, fn)` ซึ่งแจ้ง topic ที่ระบุหลัง commit หนึ่งครั้ง และไม่แจ้งเมื่อ rollback `useLiveQuery(sql, params, topics)` อ่านใหม่ตาม topic และทิ้งผลของการอ่านรอบเก่า ไม่เปิด `enableChangeListener` เลย ดังนั้นการแจ้งจึงตรงตาม ADR โดยไม่ต้องรวม event เอง เมื่อถึง `agent-and-task` ค่อยใส่รหัส Task กับเลข N เป็นข้อมูลของ topic

schema ใช้ `PRAGMA user_version` กับรายการ migration ในโค้ด ตารางแรกคือ `device_setting(key, value)` สำหรับภาษา test ใช้ `bun:sqlite` ห่อให้มี method ที่ `shared/db` เรียก เพื่อรัน SQL จริงโดยไม่ต้องมี interface เพิ่มในโค้ดของแอป

### บนเว็บทำตาม spike ของ ADR 0021

- Metro รู้จัก `.wasm` ผ่าน `metro.config.js`
- ไม่ตั้ง COOP/COEP ตาม ADR 0021 แม้เอกสาร SDK 58 จะบอกให้ตั้ง เพราะ spike ยืนยันแล้วว่า API แบบ async ไม่ต้องใช้ task ตรวจซ้ำกับ build จริง
- ตัวถือแท็บใช้ Web Locks กับ BroadcastChannel อยู่ใน `.web.ts` แท็บใหม่ขอ lock แบบ `ifAvailable` ถ้าไม่ได้จะแสดงหน้า "ใช้ที่นี่" เมื่อกดจะ broadcast ขอ แท็บเดิมปิดฐานข้อมูลแล้ว reload ส่วนแท็บใหม่รอ lock แบบไม่มี `ifAvailable` การปล่อยตอนปิดแท็บ browser จัดการให้เอง
- การส่งต่อต้อง reload เพราะ worker ของ `expo-sqlite` ถือ OPFS handle จนหน้าเว็บหายไป `closeAsync` ไม่ได้ปล่อย และเมื่อเปิดครั้งแรกไม่สำเร็จ worker ตัวนั้นจะตอบ `Invalid VFS state` ทุกครั้ง ผลคือแท็บเดิมเสีย state ใน memory ตอนถูกย้าย แท็บใหม่รอ 150 ms หลังได้ lock เผื่อ handle ปล่อยช้ากว่า lock ถ้ายังเปิดไม่ได้จะ reload ตัวเองแล้วรอ lock ใหม่ได้สูงสุด 3 ครั้ง
- เรียก `navigator.storage.persist()` แบบไม่สนผล

### เปิดฐานข้อมูลไม่ได้ก็ขึ้นหน้าแจ้ง

ตัวกั้นใน `src/app` มีสถานะ `failed` ซึ่ง render หน้า `storage-unavailable` แทน `<Stack />` ใช้ทุกสาเหตุ ทั้งหน้าต่างส่วนตัวและพื้นที่เต็ม ถ้าเปิดไม่ได้ตอนเริ่มแอปจะขึ้นหน้านี้ทันที การ reload ซ้ำเก็บไว้ใช้เฉพาะหลังกด "ใช้ที่นี่" ซึ่งเป็นกรณีเดียวที่รอแล้วหายได้เอง ปุ่มลองใหม่บนเว็บคือ reload เพราะ worker ที่ล้มไปแล้วใช้ต่อไม่ได้

ทางเลือกที่ตัดออก:
- **database ในหน่วยความจำ ตามที่ ADR 0021 เขียนไว้เดิม**: `AccessHandlePoolVFS.create` ล้มเหลวก่อนจะเปิด `:memory:` ได้
- **patch `expo-sqlite` ให้ข้าม VFS แบบไฟล์**: หน้าต่างส่วนตัวใช้แอปได้ แต่ต้องดูแล patch ทุกครั้งที่อัปเกรด SDK และกุญแจก็หายตอนปิดหน้าต่างอยู่ดี

### i18next ตัวเดียว และ hook สั้นๆ เอง

ADR 0065 เลือก `i18next` ส่วนการ re-render เมื่อเปลี่ยนภาษาใช้ `useSyncExternalStore` ฟัง `languageChanged` แล้วคืน `getFixedT` ราวสิบบรรทัด ไม่เพิ่ม `react-i18next` หนึ่ง slice คือหนึ่ง namespace ตาม `src/<layer>/<slice>/i18n/{th,en}.json` และ export ผ่าน public API ของ slice ชั้น `src/app` รวบรวมและประกาศ type ของ resource จาก `en.json` เพราะ `shared` import ชั้นบนไม่ได้

`errors` เป็น namespace ใน `shared/i18n` key ซ้อนตาม code เช่น `hub.machine_offline` และ `describeError(body)` เช็กด้วย `exists` ก่อน ถ้าไม่พบคืน `errors:unknown` พร้อม code ครบสาม code ที่ Hub ส่งวันนี้ ค่าภาษาของ Member อยู่ใน `device_setting` แท็บที่ยังไม่ได้ถือฐานข้อมูลจึงใช้ภาษาจากเครื่อง

### ตัวตรวจ key เป็น script ของ bun

`controller/scripts/check-i18n.ts` ไล่ `src/**/i18n/` เทียบ key แบบตัด suffix พหูพจน์ `_(zero|one|two|few|many|other)` และเทียบชุด `{{ตัวแปร}}` ส่วนเปรียบเทียบเป็นฟังก์ชันล้วนที่มี test ไม่ใช้ `i18next-parser` เพราะเราต้องการแค่สองภาษาครบ และ type ตรวจการเรียกอยู่แล้ว

### สร้างแอปใหม่ และคัดลอกแค่ UI ที่ design system กำหนด

`controller/` ไม่ต่อจาก prototype แต่นำ `theme.ts`, `Text`, `Button`, `Card` และ `Icon` มาเท่าที่หน้าจอใช้ เพราะเป็นตัวแทนของ design system ไม่ใช่ logic ของ prototype เวอร์ชัน Expo กับ React Native ต้องตรงกับ prototype ทุกตัว เพราะ `node_modules` แบบแบนมี React Native ได้รุ่นเดียว bundle id ใช้ `dev.veeloe.controller` ชั่วคราวจนกว่าจะตั้ง EAS

## Risks / Trade-offs

- [Hermes บน iOS ไม่มี `Intl.PluralRules` ลองแล้ว ภาษาไทยที่ count เป็น 1 จึงตกไปเป็นภาษาอังกฤษ] → เขียนกฎของไทยกับอังกฤษเองใน `shared/i18n/plural-rules.ts` ภาษาที่สามต้องเพิ่มกฎ หรือเปลี่ยนไปใช้ `intl-pluralrules`
- [ฐานข้อมูลบนเว็บหายได้ ค่าภาษาจึงกลับไปเป็นภาษาของเครื่อง] → ยอมรับ เพราะเลือกใหม่ได้ทันที และ ADR 0021 ถือว่าเป็น cache
