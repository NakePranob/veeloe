# คำสั่งของ Agent รันใน sandbox ระดับ OS และ v0.1 รองรับแค่ macOS กับ Linux

Allowlist ดูแค่ว่า Agent เรียกคำสั่งอะไร แต่ไม่รู้ว่าข้างในคำสั่งทำอะไร เช่น `npm test` ที่ script แอบอ่าน `~/.ssh` แล้วส่งออกไปทางเน็ต Runtime จึงครอบทุกคำสั่งที่ Agent รันด้วย `@anthropic-ai/sandbox-runtime` ซึ่งบน macOS ใช้ Seatbelt และบน Linux ใช้ bubblewrap ภายใต้ sandbox นี้ Agent เขียนไฟล์ได้แค่ใน Workdir ของตัวเอง อ่าน Workdir ของ Agent อื่นไม่ได้ ยกเว้น Agent ที่อยู่ Team เดียวกัน (ADR 0026) อ่านไฟล์ลับไม่ได้ และออกเน็ตได้เฉพาะโดเมนที่อนุญาต ทั้งหมดนี้ไม่ต้องใช้ Docker ส่วน Windows ยังไม่มีรุ่น native เพราะการทำ sandbox บน Windows ยังไม่ชัดเจน คนใช้ Windows ให้ติดตั้ง Runtime รุ่น Linux ใน WSL2 ซึ่งใช้ bubblewrap ได้ตามปกติ ข้อจำกัดคือ Agent จะทำงานอยู่ฝั่ง Linux และแตะ tool ที่เป็นของ Windows โดยตรงไม่ได้ ส่วนรุ่น native จะทำเมื่อ sandbox-runtime รองรับ Windows ชัดเจนแล้ว เราจะไม่เขียน sandbox บน Windows เอง เพราะเป็นงานด้านความปลอดภัยที่พลาดง่าย

sandbox ครอบทั้งโปรเซส worker ของ Agent (ADR 0020) ไม่ได้ครอบแค่คำสั่ง shell เหตุผลคือถ้า tool อ่านหรือเขียนไฟล์รันอยู่นอก sandbox Agent ก็สร้าง symlink ใน Workdir ชี้ไปที่ `~/.ssh` แล้วสั่ง tool read ให้อ่านผ่าน symlink นั้นได้โดยที่ sandbox ไม่รู้เรื่องเลย เมื่อครอบทั้ง worker แล้ว tool ทุกตัวและ shell ทุกคำสั่งจะอยู่ใต้กฎชุดเดียวกันที่ OS เป็นคนบังคับ สิ่งที่ต้องเปิดให้ worker ได้แก่ ไฟล์ SQLite ของตัวเอง, ช่องทางคุยกับ supervisor, โดเมนของ Provider และโดเมนที่อนุญาต (รายชื่อโดเมนนี้ใช้ร่วมกันทั้ง Machine ดูข้อจำกัดด้านล่าง)

supervisor เรียก `SandboxManager.initialize()` ครั้งเดียว เพราะ proxy ของเน็ตอยู่ใน supervisor จากนั้นเปิด worker ของแต่ละ Agent ด้วย `wrapWithSandbox()` แล้วตามด้วย `Bun.spawn` ห้ามใช้ CLI `srt` เพราะช่อง ipc จะหายไปเงียบๆ และเปลือง RAM ราว 73 MB ต่อ worker แต่ละ worker ต้องมี TMPDIR ของตัวเอง (`CLAUDE_CODE_TMPDIR`) เพราะค่าเริ่มต้นคือ `/tmp/claude` ซึ่งทุก Agent ใช้ร่วมกัน และกลายเป็นช่องที่ Agent ส่งข้อมูลหากันได้

## Considered Options

- **Docker container ต่อ Agent**: แยกขาดที่สุดและใช้ได้ทุก OS แต่ลูกค้าต้องมี Docker และ Agent จะแตะไฟล์กับ tool จริงบนเครื่องได้ยาก
- **Allowlist + Approval อย่างเดียว**: กันเคส `npm test` ข้างบนไม่ได้

## Consequences

- sandbox-runtime ยังเป็น research preview API อาจเปลี่ยนได้ ต้อง pin เวอร์ชันไว้
- spike ยืนยันแล้วว่า sandbox-runtime 0.0.80 ครอบ worker ที่รันนานได้ ทดสอบบน macOS 200 วินาที ผลคือ อ่านไฟล์ลับไม่ได้ทั้งแบบตรงและผ่าน symlink, hard link ไฟล์ลับไม่ได้, เขียนนอก Workdir ไม่ได้, คำสั่งลูกโดนกฎชุดเดียวกัน, ออกเน็ตได้เฉพาะโดเมนที่อนุญาต และ bun:sqlite ในโหมด WAL ใช้ได้ ส่วนการครอบเพิ่มเวลาเริ่มราว 16 ms และ RAM ของ worker ไม่เพิ่ม บน Linux (bubblewrap ใน Docker) การอ่าน การเขียน และคำสั่งลูกก็ผ่านเหมือนกัน
- **รายชื่อโดเมนที่อนุญาตใช้ร่วมกันทั้ง Machine** sandbox-runtime แยกรายชื่อต่อ Agent ไว้แค่เพื่อบันทึกว่าใครเรียก ไม่ได้แยกจริง เราจึงให้ Egress เป็นค่าที่ตั้งต่อ Machine ไม่ใช่ต่อ Agent และแอปต้องเขียนบอกให้ชัดว่า Agent ทุกตัวบนเครื่องนั้นออกไปโดเมนเหล่านี้ได้ ความเสี่ยงที่เหลือมีจำกัด เพราะ token ของแต่ละ Agent ยังอยู่ใน Workdir ที่ sandbox กันไว้ Agent ที่ได้ออกไปโดเมนของอีกตัวจึงไม่มี token ไปใช้ ยกเว้น Agent ที่อยู่ Team เดียวกัน ซึ่งอ่าน Workdir ของกันได้ ส่วนที่เหลือคือข้อมูลยังส่งออกไปยังโดเมนที่อยู่ในรายชื่อได้ ถ้าวันหลังต้องแยกจริง ให้ทำ proxy ต่อ Agent
- ถ้ารัน Runtime อยู่ใน Docker ต้องผ่อนการป้องกันของ container (`seccomp=unconfined` ร่วมกับ `systempaths=unconfined` หรือโหมด `enableWeakerNestedSandbox`) ไม่ต้องใช้ `--privileged` ถ้ารันเป็น root ต้องให้ root เป็นเจ้าของ Workdir ด้วย ส่วน Linux ที่ไม่ได้อยู่ใน container ยังไม่ได้ทดสอบ
- ยังไม่ได้ทดสอบการรันที่นานกว่า 200 วินาที และการใช้ `bun install` หรือ cache ของ package ใน sandbox
