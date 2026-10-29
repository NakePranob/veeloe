# โครงโค้ดของแต่ละส่วน และทุกส่วนมีตัวตรวจโครงสร้างใน CI

โค้ดส่วนใหญ่จะเขียนโดย agent ถ้าโครงสร้างไม่มีตัวบังคับ โค้ดจะค่อยๆ เละ ทุกส่วนจึงต้องมีตัวตรวจทิศทางการ import ใน CI แต่ละส่วนเลือกรูปแบบตามลักษณะงานของตัวเอง ไม่ได้ใช้แบบเดียวกันทั้งหมด

- **Controller**: ใช้ Feature-Sliced Design เต็มรูปแบบ ชั้นต่างๆ (app, pages, widgets, features, entities, shared) อยู่ใต้ `src/` ส่วน `app/` ที่ root เป็นไฟล์ route บางๆ ของ Expo Router ที่ import มาจาก pages การคำนวณ Mood อยู่ใน entities/character ส่วน db, sync, protocol client และ keystore อยู่ใน shared ตัวตรวจคือ Steiger
- **Runtime / supervisor**: งานของ supervisor เป็นแบบเดียวกันทุกชนิดข้อความ คือตรวจลายเซ็น ตรวจสิทธิ์ แล้วส่งต่อ จึงแบ่งเป็น slice ตามชนิดของข้อความ (pairing, linking, task-message, approval-answer, stop, agent-config, team-config, delegation, sync) ส่วน hub-link, trust, updater และ cli เป็น module ร่วม
- **Runtime / worker**: เป็น hexagonal แกน (Turn, คิว, Allowlist, การหมดอายุของ Approval, Stop) เป็นโค้ดล้วนที่ไม่แตะ IO และคุยกับข้างนอกผ่าน port ได้แก่ Clock, EventStore, Provider, ToolRunner และ SupervisorLink adapter มี sqlite, Anthropic SDK, tool ต่างๆ และ ipc ตัวตรวจคือ dependency-cruiser ซึ่งตรวจว่าแกนไม่ import adapter และ supervisor กับ worker ไม่ import กัน (คุยกันผ่าน ipc เท่านั้น)
- **Hub**: module ของ go-scaffold ทั้งหมด (ADR 0014) relay ก็เป็น module แบบ hexagonal ในโครงเดียวกัน domain ของ relay คือกฎการส่งต่อ (ตอบทันทีเมื่อปลายทางออฟไลน์, ตัดสินว่าจะส่ง push ไหม) port ได้แก่ PresenceRegistry และ PushSender relay ไม่ตรวจการส่งงานใน Project เพราะ Project อยู่บน Machine เดียวและ Runtime เป็นคนตรวจ (ADR 0026) ส่วน keyauth เป็น middleware ใน infra กลาง ตัวตรวจคือ `go-scaffold check`
- **Protocol**: แบ่งเป็น envelope, crypto, messages (ชนิดละไฟล์) และ events และ export JSON Schema ของหัวซองออกมา เพื่อให้ CI ฝั่ง Hub ตรวจได้ว่า struct ใน Go ยังตรงกัน

**Test seam มีสองจุด** จุดแรกคือ protocol ของ Controller โดยรัน Hub ตัวจริง Runtime ตัวจริงหลายตัว และใช้ Provider ปลอม อยู่ใน `e2e/` (ADR 0025) จุดที่สองคือแกนของ worker ซึ่งใช้ Clock ปลอมกับ port ปลอมอื่นๆ เพื่อทดสอบเรื่องอย่างการหมดอายุของ Approval ที่ไม่มีใครรอ 1 ชั่วโมงใน test ได้

## Considered Options

- **Controller แบบ feature folders หรือวางทุกอย่างไว้ใน route**: เริ่มได้เร็วกว่า แต่ไม่มีกฎบังคับทิศ import และ logic ที่ใช้หลายหน้า (เช่น Mood) จะกระจายหรือถูกเขียนซ้ำ
- **hexagonal ทั้ง Runtime**: สม่ำเสมอกับ Hub แต่ supervisor เกือบทั้งหมดเป็น IO จะได้ port ที่ไม่มีใครใช้แทนได้เต็มไปหมด
- **relay เป็น package แยกนอกโครงของ scaffold**: ไม่ต้องแก้ go-scaffold แต่ส่วนที่เป็นหัวใจของ Hub จะไม่ถูก `check` ตรวจ

## Consequences

- spike กับ go-scaffold 0.13.0 ยืนยันว่า relay ใช้ได้ ถ้าทำตามข้อตกลงต่อไปนี้: relay เป็น module แบบ Lean, WebSocket adapter (coder/websocket) อยู่ใน `adapters/inbound/http/ws.go` เพราะ WebSocket เริ่มจากการ upgrade HTTP, relay อ่านข้อมูลของ module อื่นผ่าน `internal/composition` เท่านั้น โดยสอง module ไม่ import กันเอง, keyauth อยู่ใน `internal/shared/middleware` และรับฟังก์ชันหากุญแจเข้ามาแทนที่จะทำ IO เอง ส่วน test ที่ต่อ client สองตัวให้อยู่ใน `composition_test.go` ที่ root ของ module ผลคือ build, vet, `check` และ test ที่รันกับ `-race` ผ่านทั้งหมด
- ต้องแก้ go-scaffold ก่อนจะใช้ `check` เป็นด่านจริง (1) `check` ตรวจแค่ `adapters/inbound/http` ถ้าเอาโค้ดไปไว้ในโฟลเดอร์อื่นใต้ inbound แล้ว import gorm หรือ module ข้างเคียง จะผ่านการตรวจไป (2) regex ของกฎใน application, ports และ outbound ลงท้ายด้วย `\/` ทำให้ import อย่าง `shared/apperror` ผ่านไปได้ (3) module ที่ไม่มี database อย่าง relay ยังต้องเก็บไฟล์ repository, model และ dto ที่ไม่ได้ใช้ไว้ เพราะ `check` บังคับ ต้องเพิ่ม surface แบบ `none` หรือ `realtime` ระหว่างนี้ให้เก็บไฟล์เหล่านั้นไว้ก่อน ยกเว้นไฟล์ migration ของ relay ที่ลบได้ ทั้งสามข้อแก้แล้วและ release แล้วใน go-scaffold 0.14.0 Hub ต้องใช้ 0.14.0 ขึ้นไป และให้สร้าง relay ด้วย `--surface none`
- presence ที่อยู่ในหน่วยความจำใช้ได้กับ Hub ที่รันอยู่ตัวเดียวต่อ Workspace ซึ่งตรงกับการแบ่ง Workspace ไปไว้คนละเครื่องตาม ADR 0007
- ชั้นของ FSD ทำให้มีโฟลเดอร์เยอะ และต้องคิดทุกครั้งว่าโค้ดชิ้นใหม่ควรอยู่ชั้นไหน
