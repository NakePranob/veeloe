## 1. Tool และขอบเขต

- [x] 1.1 เพิ่ม `packages/runtime/src/worker/adapters/files.ts` ที่มี `resolveInWorkdir(workdir, input)` ตรวจ path relative/absolute, `..`, symlink และโฟลเดอร์พ่อด้วย `realpath` ตรวจด้วย test ว่า relative กับ absolute ที่อยู่ข้างในผ่าน, `../` และ absolute นอก Workdir ถูกปฏิเสธ, symlink ที่ชี้ไปนอกถูกปฏิเสธทั้งอ่านและเขียน และไฟล์ใหม่ที่โฟลเดอร์พ่ออยู่นอกถูกปฏิเสธ

- [x] 1.2 เพิ่ม `read` ใน `files.ts` ที่คืนเลขบรรทัด, รองรับ `offset`/`limit`, ตัดที่ 2,000 บรรทัดหรือ 256KB, ปฏิเสธไฟล์ไบนารีและไฟล์ที่ไม่มี ตรวจด้วย test เรื่องไฟล์ 3 บรรทัด, offset/limit, ไฟล์ 5,000 บรรทัดถูกตัดพร้อมข้อความ, NUL ไบต์, ENOENT และ path นอก Workdir

- [x] 1.3 เพิ่ม `write` ที่สร้างโฟลเดอร์พ่อ เขียน temp แล้ว rename, คง mode เดิม และจำกัด 2MB ตรวจด้วย test เรื่องสร้างไฟล์ในโฟลเดอร์ใหม่, เขียนทับแล้วไม่มีไฟล์ temp ค้าง, mode เดิมยังอยู่, เนื้อหาเกิน 2MB ถูกปฏิเสธ และ path นอก Workdir

- [x] 1.4 เพิ่ม `edit` ที่แทนข้อความเมื่อเจอครั้งเดียว, รองรับ `replace_all`, ตอบ error พร้อมจำนวนเมื่อเจอ 0 หรือหลายครั้ง, คง mode และไม่แตะไฟล์เมื่อ error ตรวจด้วย test ครบทุกกรณีรวมทั้ง `old_string` ว่างและ line ending เดิม

## 2. ค้นหา

- [x] 2.1 เพิ่ม `glob` ด้วย `Bun.Glob` จากราก Workdir คืน path relative เรียงลำดับ จำกัด 200, ข้าม `.git` และ `node_modules`, ไม่คืนโฟลเดอร์ ตรวจด้วย test เรื่อง pattern, เกินเพดาน, ไม่มีผล และ pattern ผิด

- [x] 2.2 เพิ่ม `grep` ที่ค้น regex ในไฟล์ตาม `include`, รองรับ `ignore_case`, คืน `path:line: ข้อความ`, จำกัด 200, ข้ามไบนารี/ไฟล์เกิน 1MB/`.git`/`node_modules` ตรวจด้วย test เรื่องพบข้อความ, ไม่พบ, เกินเพดาน, ตัวพิมพ์, regex ผิด และไฟล์ไบนารีถูกข้าม

## 3. การต่อเข้ากับ worker

- [x] 3.1 เพิ่มโหมด `readOnly` ใน `fileTools` ที่มีเฉพาะ `read`, `glob`, `grep` และ error เมื่อเรียก `write`/`edit` ตรวจด้วย test เรื่อง definitions และการเรียกที่ถูกปฏิเสธ

- [x] 3.2 เพิ่ม `worker/adapters/tools.ts` ที่มี `combineTools(runners)` รวม definitions และส่ง run ตามชื่อ พร้อม throw เมื่อชื่อซ้ำ และให้ `worker/index.ts` ใช้ `combineTools([bashTool(...), fileTools({ workdir })])` ตรวจด้วย test ว่า definitions มี `bash`, `read`, `write`, `edit`, `glob`, `grep` อย่างละหนึ่งและชื่อที่ไม่รู้จัก error

## 4. ตรวจปลายทาง

- [x] 4.1 เพิ่ม flow test ที่ใช้ worker จริงกับ Provider ปลอมให้ LLM ขอ `write` แล้วขอ `read` ไฟล์เดียวกัน ตรวจว่าไฟล์อยู่ใน Workdir, ผลลัพธ์มีเลขบรรทัด และ event `tool.result` มีเนื้อหาตามที่เขียน

- [x] 4.2 ตรวจด้วย manual/e2e ใน sandbox จริงว่า symlink ที่ชี้ไปนอก Workdir ถูกปฏิเสธ, การเขียนนอก Workdir ถูกปฏิเสธ และคำสั่ง `bash` ยังทำงานเหมือนเดิม

- [x] 4.3 เขียน `manual-checks.md` ให้เจ้าของลองกับ Agent จริงบน macOS/Linux: อ่าน แก้ เขียน ค้นไฟล์ ค้นข้อความ, ไฟล์ใหญ่, ไฟล์ไบนารี, symlink และ `.git/hooks` ที่เจ้าของควรระวัง และแก้ `AGENTS.md` ถ้ามีคำสั่งหรือไฟล์ใหม่ที่ต้องบอก

- [x] 4.4 รัน `bun run check` กับ `bun run test` และตรวจว่า dependency-cruiser ยังผ่าน (adapter ใหม่ไม่แตะ core)
