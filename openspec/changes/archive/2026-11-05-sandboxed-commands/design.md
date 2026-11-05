## Context

- `agent-and-task` วาง worker หนึ่งโปรเซสต่อ Agent ที่ supervisor เปิดด้วย `Bun.spawn` พร้อม `ipc` โดยมี cwd เป็น Workdir และ `TMPDIR` เป็น `agents/<id>/tmp` แกนของ worker เรียก tool ผ่าน port `ToolRunner` ซึ่งตอนนี้มีแค่ `no-tools` และ tool round ใน `runTurn` บันทึก `llm.message` ที่มี `tool_use` แล้วตามด้วย `tool.result` ที่มี `is_error`
- worker คุยกับ LLM ทาง HTTP ที่ proxy `Bun.serve` บน `127.0.0.1` port สุ่ม พร้อมรหัสสุ่มใน `VEELOE_PROXY_TOKEN` ส่วน ADR 0008 และ 0042 เขียนว่าช่องทางคุยกับ supervisor เป็นทางเดียวที่คำขอไป LLM วิ่งผ่าน
- ADR 0008 ตัดสินแล้วว่าใช้ `@anthropic-ai/sandbox-runtime` ครอบทั้ง worker โดย supervisor เรียก `SandboxManager.initialize()` ครั้งเดียว แล้วเปิด worker ด้วย `wrapWithSandbox()` ตามด้วย `Bun.spawn` ห้ามใช้ CLI `srt` spike ของ ADR ผ่านบน macOS กับ sandbox-runtime 0.0.80 และบน Linux ใน Docker แต่ยังไม่ได้ลอง Linux นอก container
- sandbox-runtime ทำ Egress ด้วย proxy HTTP กับ SOCKS ที่อยู่ในโปรเซสที่เรียก `initialize()` บน macOS Seatbelt ยอมให้ออกเน็ตได้แค่ไปที่ proxy นี้ บน Linux bubblewrap แยก network namespace แล้วต่อ proxy ผ่าน unix socket ด้วย socat ผลคือ worker ใน sandbox ต่อ `127.0.0.1:<port ของ proxy LLM>` ไม่ได้ อย่างน้อยบน Linux
- Controller มี `keySession.withFreshAuthentication` สำหรับคำสั่งที่ต้องยืนยันตัวใหม่ หน้า Task ใช้ `items()` ใน `pages/task/model/items.ts` ซึ่งตอนนี้ข้าม `tool_use` กับ `tool.result`

## Goals / Non-Goals

**Goals:**
- Owner สั่ง Agent ให้รันคำสั่งบน Machine จริงจากมือถือ เห็นคำสั่งกับผลในหน้า Task และกำแพงตาม ADR 0008 ถูกพิสูจน์ด้วย test ที่ลองหนีจริงบน Linux ใน CI และบน macOS ด้วยมือ
- โครงที่ `workdir-file-tools` ใส่ tool ไฟล์ และ `approval-and-allowlist` ใส่ตัวกรองหน้า bash ได้โดยไม่ต้องแก้ sandbox

**Non-Goals:**
- Approval และ Allowlist ทุกแบบ รวมถึงตัวแยกท่อนของคำสั่ง (ADR 0030)
- Egress ต่อ Agent, โหมดทั้งเน็ต และการกันที่อยู่ภายในที่โดเมนชี้ไป (ADR 0029)
- Stop ระหว่างคำสั่งรัน, shell ที่ค้างไว้ข้ามคำสั่ง, ส่งผลของคำสั่งทีละส่วนระหว่างรัน
- Runtime ใน Docker (`enableWeakerNestedSandbox`) และ Windows native

## Decisions

### sandbox ครอบทั้ง worker ด้วย sandbox-runtime ตาม ADR 0008

ไม่ได้เลือกใหม่ ADR 0008 ตัดสินไว้แล้ว: Seatbelt บน macOS และ bubblewrap บน Linux ผ่าน `@anthropic-ai/sandbox-runtime` ที่ pin เวอร์ชันตรงตัว (เริ่มจาก 0.0.80 ที่ spike ผ่าน หรือตัวใหม่กว่าที่ผ่านข้อ 1.1) ทางเลือกที่ ADR ตัดไปแล้วคือ Docker ต่อ Agent และ Allowlist อย่างเดียว ส่วน landlock หรือ seccomp ที่เขียนเอง ADR ห้ามไว้โดยนัยเพราะเป็นงานความปลอดภัยที่พลาดง่าย

module ใหม่ `supervisor/sandbox/` ทำสามอย่าง

- `check()` ตอนเริ่ม: เรียกการตรวจ dependency ของ sandbox-runtime ถ้า OS ไม่ใช่ macOS หรือ Linux หรือขาด bubblewrap หรือ socat ให้พิมพ์สิ่งที่ขาดพร้อมคำสั่งติดตั้ง (`apt install bubblewrap socat` หรือเทียบเท่า) แล้วจบด้วย exit code 1 ก่อนเปิด worker ตัวแรก ไม่มีโหมดรันนอก sandbox แม้ตอนพัฒนา เพราะ macOS มี Seatbelt ในตัวอยู่แล้ว
- `policyFor(home, agentId)` เป็นฟังก์ชันล้วนที่คืนกฎของ worker ตัวนั้น (ดูหัวข้อถัดไป) test ได้โดยไม่ต้องมี sandbox
- `wrap(command, policy)` เรียก `wrapWithSandbox()` แล้วคืน argv ให้ `createWorkers` ใช้แทน `command` เดิม `createWorkers` รับ `wrap` เป็น parameter test ของ supervisor ที่มีอยู่จึงส่งตัวที่คืน argv เดิมได้ ส่วน e2e ใช้ตัวจริง

### กฎของ worker หนึ่งตัว

- **เขียนได้:** `agents/<id>/` ทั้งโฟลเดอร์ เพราะ SQLite สร้าง `tasks.db-wal` กับ `-shm` ข้าง `tasks.db` จึงต้องเขียนโฟลเดอร์นั้นได้ เมื่อมี `skills/` ใน ADR 0038 ให้ใส่เป็นห้ามเขียน
- **ห้ามอ่าน:** `<VEELOE_HOME>` ทั้งหมด ยกเว้น `agents/<id>/` และ `bin/` (binary ของ worker เอง) ตามด้วยรายชื่อไฟล์ลับคงที่ในโค้ดที่เดียว: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.git-credentials`, `~/.config/gh`, `~/.password-store`, `~/Library/Keychains`, history ของ shell และโฟลเดอร์ profile ของเบราว์เซอร์ รายชื่อนี้ไม่ให้แก้จากแอปใน change นี้
- **เครือข่าย:** `allowedDomains` เป็น Egress ของ Machine ไม่เปิด `allowLocalBinding` และไม่เปิด unix socket ใดๆ
- **environment:** เพิ่ม `CLAUDE_CODE_TMPDIR=agents/<id>/tmp` ตาม ADR 0008 และเอา `VEELOE_PROXY_URL` กับ `VEELOE_PROXY_TOKEN` ออก (ดูหัวข้อ LLM)

"ห้ามอ่านทั้งโฟลเดอร์ยกเว้นโฟลเดอร์ย่อย" เป็นจุดที่ยังไม่แน่ใจว่า sandbox-runtime เวอร์ชันที่ pin ทำได้ตรงๆ ถ้าทำไม่ได้ ให้ห้ามอ่านทีละรายการ คือ `config.json`, กุญแจของ Machine, `runtime/`, `libraries/`, `projects/` และ `agents/*` ที่ไม่ใช่ตัวเอง ซึ่งรายการหลังต้องรวม Agent ที่สร้างทีหลังด้วย ทางที่ยอมรับได้คือเมื่อสร้าง Agent ใหม่ ให้เปิด worker ที่ว่างอยู่ใหม่ด้วยกฎใหม่ และ worker ที่กำลังทำ Turn เปิดใหม่เมื่อ Turn จบ ข้อ 1.1 ตัดสินว่าใช้ทางไหน

ทางเลือกที่ตัดออก: ห้ามอ่านทั้ง `$HOME` แล้วเปิดทีละที่ ปลอดภัยกว่า แต่ ADR 0008 ให้ Turn ของคนที่มี Manage อ่านไฟล์อื่นบนเครื่องได้ และ Agent จะใช้ toolchain ที่ติดตั้งใน home เช่น `~/.bun` หรือ `~/.nvm` ไม่ได้

### คำขอไป LLM วิ่งผ่าน IPC แทน port บนเครื่อง

worker ใน sandbox ต่อ proxy ที่ `127.0.0.1` ไม่ได้ จึงย้ายคำขอมาที่ช่อง IPC ที่มีอยู่ ซึ่งตรงกับข้อความของ ADR 0008 และ 0042 อยู่แล้ว และกลับการตัดสินใน `agent-and-task` ที่เลือก HTTP เพราะคิดว่าต้องเขียน transport ของ SDK เอง ซึ่งจริงๆ `@anthropic-ai/sdk` รับ `fetch` ที่ส่งเข้าไปเองได้

- worker: `anthropic-llm.ts` ส่ง `fetch` ของตัวเองให้ SDK ซึ่งแปลง `Request` เป็น `{ kind: "llm.request", id, path, headers, body }` ทาง IPC แล้วรอ `{ kind: "llm.response", id, status, headers, body }` มาสร้าง `Response`
- supervisor: `startLlmProxy` เปลี่ยนจาก `Bun.serve` เป็นฟังก์ชัน `handleLlm(agentId, request)` ที่ใช้กฎเดิมทั้งหมด (path ที่อนุญาต, ตัดหัว, ใส่ key, เขียน model ทับ, หัว `x-veeloe-error`) Agent มาจากช่อง IPC ไม่ใช่รหัส รหัสของ worker กับ `agentOfToken` จึงลบทิ้ง
- คำตอบส่งกลับทั้งก้อนหลัง Provider ส่งครบ รวม SSE เพราะ worker ใช้แค่ `finalMessage()` อยู่แล้ว

ponytail: คำตอบทั้งก้อนใน IPC ข้อความเดียว เมื่อ `controller-task-screens` ต้องการ delta ระหว่างพิมพ์ ให้ส่ง `llm.chunk` ทีละส่วนแทน

ทางเลือกที่ตัดออก: proxy ฟังที่ unix socket ใน `agents/<id>/` ต้องเปิด unix socket ใน sandbox ซึ่งบน Linux sandbox-runtime เปิดได้แค่ทั้งหมดหรือไม่เลย และจะเปิดทางไป socket อื่นอย่าง `docker.sock` หรือ ssh-agent ด้วย ส่วนการใส่ `localhost` ใน Egress เปิดทุก port บนเครื่องให้ Agent

### Egress รายชื่อเดียวของ Machine แก้จากแอป

- เก็บใน `runtime/egress.json` ผ่าน `writeJsonFile` เดิม ไม่มีไฟล์แปลว่าว่าง slice ใหม่ `supervisor/egress/` รับ `egress.set` และเข้ากฎ dependency-cruiser ว่า slice ไม่ import กัน
- Protocol เพิ่ม `egress.set` (Controller → Machine) body `{ egress: string[] }` ส่งทั้งชุดแทน add กับ remove เพราะส่งซ้ำแล้วได้ผลเดิม และตอบด้วย `agent.listed` ตัวเดิมที่เพิ่ม field `egress: string[]` แบบ additive (ADR 0023) เหมือนที่ `agent.create` ตอบ schema ของโดเมน `EgressDomainSchema` อยู่ใน `packages/protocol` ให้ Controller กับ supervisor ใช้ตัวเดียวกัน: ชื่อโดเมนตัวเล็กที่มี TLD เป็นตัวอักษร หรือ `*.` นำหน้าหนึ่งระดับ ไม่เกิน 100 รายการ ซึ่งตัด IP, `localhost`, scheme และ path ออกโดยรูปแบบ
- เมื่อบันทึกแล้ว supervisor อัปเดตรายชื่อของ sandbox-runtime ทันทีโดยไม่เปิด worker ใหม่ ถ้าเวอร์ชันที่ pin อัปเดตขณะรันไม่ได้ ให้ส่งตัวกรองโดเมนที่อ่านค่าปัจจุบันทุกครั้งแทน ข้อ 1.1 ยืนยัน
- `unpair` ลบ `egress.json` พร้อม `agents.json`

ทางเลือกที่ตัดออก: `veeloe egress add` ที่หน้าเครื่องแบบเดียวกับ Provider ไม่ต้องแตะ Protocol แต่ ADR 0008 ให้แอปบอกรายชื่อนี้อยู่ดี CONTEXT.md ให้แก้ Egress ต้องยืนยันตัวใน Controller และ prototype ทำไว้ที่หน้า Machine แล้ว ส่วน Egress ต่อ Agent ADR 0029 เลื่อนไปจนมี Member คนที่สองหรือ Channel

### tool `bash`

adapter ใหม่ `worker/adapters/bash.ts` ทำ `ToolRunner` ตัวแรก แทน `no-tools` ใน `worker/index.ts`

- input `{ command: string, timeout?: number }` เป็นวินาที ค่าเริ่มต้น 120 เพดาน 600
- รัน `bash -c` ที่มี `exec 2>&1` นำหน้า เพื่อให้ stdout กับ stderr รวมกันตามลำดับที่ออก cwd คือ Workdir ทุกครั้ง stdin ปิด environment คือของ worker โดยเอาตัวแปรของช่อง IPC ของ Bun ออก
- เปิดเป็นกลุ่มโปรเซสใหม่ เมื่อหมดเวลาส่ง `SIGKILL` ทั้งกลุ่ม
- ผลคือข้อความที่ได้ตามด้วย `exit code: N` เพดาน 30,000 ตัวอักษร เกินแล้วเก็บตอนท้ายพร้อมบรรทัดว่าตัดตอนต้นไปกี่ตัวอักษร exit code ไม่ใช่ 0 และการหมดเวลา adapter โยน error ที่มีข้อความเดียวกัน แกนจึงบันทึกเป็น `is_error: true` ตามกฎเดิม โดยไม่ต้องแก้ port

ponytail: ไม่มี shell ที่ค้างไว้ข้ามคำสั่ง คำอธิบายของ tool บอก LLM ว่า `cd` ไม่ติด ถ้า LLM พลาดบ่อยค่อยทำ

### ที่ว่างสำหรับ Approval

`approval-and-allowlist` จะห่อ `ToolRunner` ของ bash ด้วยตัวกรองในแกนที่ถามว่าคำสั่งอยู่ใน Allowlist หรือไม่ และหยุดรอ Approval ถ้าไม่อยู่ change นั้นต้องส่ง Task กับ Member เข้า `run` ด้วย change นี้จึงไม่เพิ่ม parameter ล่วงหน้า

### Controller: คำสั่งในหน้า Task ตาม prototype

ทำตาม `controller-prototype/src/pages/task/ui/ToolCalls.tsx` และการรวมคำสั่งที่ติดกันใน `controller-prototype/src/pages/task/model/items.ts` ส่วนผลของคำสั่งตาม `toolResults` ใน `controller-prototype/src/entities/task/model/state.ts`

- `items()` ของจริงแยก `tool_use` ออกจาก `llm.message` เป็น item ชนิด `tools` และรวมคำสั่งที่มาติดกันโดยไม่มีข้อความของ Agent คั่น ผลจับคู่ด้วย `tool_use_id` จาก `tool.result` คำสั่งที่ Turn จบก่อนได้ผลนับว่าไม่เสร็จ
- แถวแสดง `input.command` ถ้าเป็น string และชื่อ tool ถ้าไม่ใช่ เพื่อให้ tool ไฟล์ของ `workdir-file-tools` ใช้แถวเดียวกันได้
- ส่วนที่ตัดหรือเปลี่ยน: ข้อความไทยที่ฝังในโค้ดย้ายไป i18n ทั้งสองภาษา, คำว่า "หยุดก่อนเสร็จ" เป็น "ไม่เสร็จ" เพราะยังไม่มี Stop, เงื่อนไข `showHistory` กับการเปิดดูจาก Approval ไม่มีเพราะยังไม่มี Approval และผลของคำสั่งแสดงไม่เกินราว 20 บรรทัดสุดท้ายเพราะผลจริงยาวกว่าตัวอย่าง

### Controller: Egress ในหน้า Machine ตาม prototype

ทำตาม `controller-prototype/src/pages/machines/ui/EgressSection.tsx` ซึ่ง `MachinePage.tsx` ของ prototype วางไว้ใต้ Provider: รายชื่อโดเมน, ปุ่มลบต่อแถว, ช่องเพิ่มโดเมน, footer ที่บอกว่าใช้กับ Agent ทุกตัวบนเครื่องพร้อมชื่อ และแถว "ไม่มีโดเมนที่อนุญาต" เมื่อว่าง ทุกการแก้เรียก `keySession.withFreshAuthentication` แล้วส่ง `egress.set` Machine ออฟไลน์บอกก่อนโดยไม่ขอยืนยันตัว migration เพิ่มคอลัมน์ `egress` ในตาราง `machine` ที่ `machine-link` เขียนเมื่อได้ `agent.listed` ส่วนที่ตัด: เงื่อนไข `owner` เพราะ v0.1 มี Member คนเดียว และการเพิ่มโดเมนจาก Blueprint

## Risks / Trade-offs

- [ยังไม่มี Approval คำสั่งทุกตัวรันทันที ขัดกับ ADR 0030 และ Allowlist ใน CONTEXT.md ที่ว่าไม่มีคำสั่งที่ผ่านเสมอโดยไม่อยู่ในรายการ และ Allowlist เริ่มจากว่าง] → เป็นช่วงชั่วคราวบน `develop` ก่อน v0.1 ออก กำแพงจริงตาม ADR 0030 คือ sandbox กับ Egress ซึ่งมาพร้อม change นี้ และ `approval-and-allowlist` เป็น change ถัดไป `manual-checks.md` เตือนว่าอย่าลองกับเครื่องที่มีข้อมูลสำคัญนอกรายชื่อไฟล์ลับ
- [Agent แก้ `tasks.db` ของตัวเองด้วย `sqlite3` ได้ ซึ่งขัดกับ log ที่ต่อท้ายอย่างเดียว (ADR 0018)] → ผลอยู่แค่ Task ของ Agent ตัวนั้น และ Controller เก็บสำเนา event ที่ได้แล้ว การย้าย `tasks.db` ออกจากที่เขียนได้ต้องเปลี่ยน ADR 0020 จึงไม่ทำใน change นี้
- [binary ที่ `bun build --compile` อาจไม่มีไฟล์ประกอบของ sandbox-runtime เช่นตัวกรอง seccomp บน Linux] → ข้อ 1.1 ลองกับ binary จริง ถ้าขาด ฝังไฟล์ด้วย `import ... with { type: "file" }` แล้วชี้ให้ sandbox-runtime
- [Ubuntu 24.04 จำกัด user namespace ด้วย AppArmor ทำให้ bubblewrap ใช้ไม่ได้ทั้งบน CI และเครื่องลูกค้า] → CI ตั้ง sysctl ก่อนรัน e2e และ `check()` บอกวิธีเปิดเมื่อ bubblewrap ติดเรื่องนี้
- [โดเมนใน Egress อาจชี้ไปที่อยู่ภายใน] → Egress เป็นรายชื่อที่ Owner เลือกเอง การตรวจที่อยู่ปลายทางของ ADR 0029 มากับโหมดทั้งเน็ต
- [คำตอบของ LLM ทั้งก้อนใน IPC ข้อความเดียว] → คำตอบไม่เกิน `max_tokens` 8192 จึงไม่ใหญ่ ถ้าใหญ่ขึ้นค่อยแบ่งเป็น chunk
- [sandbox-runtime เป็น research preview API อาจเปลี่ยน] → pin ตรงตัว และ e2e ที่ลองหนีจริงจับได้เมื่ออัปเดต
- [ADR 0008 ยังไม่ได้ลองการรันนานกว่า 200 วินาที และ `bun install` ใน sandbox] → `manual-checks.md` มีข้อที่ลองทั้งสองอย่าง

## Migration Plan

ไม่มีข้อมูลที่ต้องย้าย `VEELOE_PROXY_URL` กับ `VEELOE_PROXY_TOKEN` หายไปพร้อมกับ supervisor และ worker เวอร์ชันเดียวกันใน binary เดียว (ADR 0020) Linux ที่อัปเดตมาโดยไม่มี bubblewrap จะเริ่มไม่ได้จนกว่าจะติดตั้ง ซึ่ง `check()` บอกวิธีไว้ ย้อนกลับได้ด้วย binary ตัวก่อน

## ผลของข้อ 1.1

pin `@anthropic-ai/sandbox-runtime` ที่ `0.0.80` ตรงตัว (0.0.81 ออกแล้วแต่ยังไม่ได้ลอง) ลองด้วย script ชั่วคราวที่เปิดตัวเองเป็นลูกผ่าน `wrapWithSandboxArgv` แล้ว `Bun.spawn` พร้อม `ipc` ทั้งรันจาก source และ binary ที่ `bun build --compile`

- **ที่ลองได้:** macOS 27 (arm64) ทั้ง source และ binary และ Linux arm64 (Debian bookworm) เฉพาะใน Docker แบบ `--privileged` ด้วย binary ที่ cross-compile **Linux นอก container ยังไม่ได้ลอง** เพราะเครื่องที่ทำงานนี้ไม่มี Linux ต้องลองใน CI (e2e บน `ubuntu-latest`) และ `manual-checks.md` ข้อ 4.x
- **(ก) กฎต่อ worker:** ได้ ส่ง `customConfig.filesystem` ตอน wrap แต่ละครั้ง ค่าใน `customConfig` แทนค่าของ `initialize()` ทีละ field ไม่ได้รวมกัน ส่วนเครือข่ายไม่ส่งใน `customConfig` ให้ใช้ของ `initialize()` ที่เดียว
- **(ข) ห้ามอ่าน `<VEELOE_HOME>` ยกเว้นโฟลเดอร์ย่อย:** ได้ตรงๆ ด้วย `denyRead: [home, ...ไฟล์ลับ]` กับ `allowRead: [agents/<id>, bin]` (README ของ sandbox-runtime เรียกว่า deny-then-allow และ `allowRead` ชนะ `denyRead`) ทั้งสอง OS อ่าน Agent อื่น `runtime/providers.json` กับ `machine.key` ไม่ได้ จึง**ไม่ใช้ทางสำรอง** Agent ที่สร้างทีหลังถูกกันด้วย `denyRead: [home]` อยู่แล้วโดยไม่ต้องเปิด worker ใหม่
- **(ค) ช่อง `ipc`:** ผ่าน ทั้ง Seatbelt และ bubblewrap
- **(ง) แก้ `allowedDomains` ขณะรัน:** ได้ด้วย `SandboxManager.updateConfig()` ซึ่ง proxy อ่านทุกการเชื่อมต่อ ลองแล้ว `curl https://example.com` ได้ 403 ก่อนแก้ และ 200 หลังแก้โดย worker ตัวเดิม จึงไม่ต้องใช้ตัวกรองโดเมน
- **(จ) `kill` supervisor:** ไม่ได้ macOS ได้ `Operation not permitted` Linux อยู่คนละ pid namespace จึงได้ `No such process`
- **(ฉ) ไฟล์ประกอบใน binary:** macOS ไม่ต้องใช้ไฟล์ประกอบ บน Linux binary **ไม่มี** `vendor/seccomp/<arch>/apply-seccomp` (sandbox-runtime เตือนว่า unix socket ไม่ถูกจำกัด) ทางที่ใช้: ฝังทั้ง x64 และ arm64 ด้วย `import ... with { type: "file" }` ตอนเริ่ม supervisor เขียนตัวที่ตรง arch ลง `<VEELOE_HOME>/bin/apply-seccomp` ด้วย `Bun.write(dest, Bun.file(embedded))` (`copyFileSync` อ่านจาก `$bunfs` ไม่ได้) แล้วส่ง `seccomp.applyPath` ให้ `initialize()` ลองแล้ว argv ที่ wrap เรียก `apply-seccomp` และ `checkDependencies()` หลัง `initialize()` ไม่เตือนแล้ว
- **ที่เจอเพิ่ม:**
  - wrap ตั้ง `TMPDIR=/tmp/claude` ให้เองทับค่าที่ส่ง worker จึงตั้ง `TMPDIR` เป็น `agents/<id>/tmp` เองตอนเริ่มจาก `VEELOE_AGENT_DIR` ให้คำสั่ง bash ได้ค่าของตัวเอง `/tmp/claude` ยังเขียนได้จากทุก worker เพราะเป็นที่เขียนได้เริ่มต้นของ sandbox-runtime ที่ปิดไม่ได้ แต่ไม่มีอะไรของ Veeloe ใช้ที่นั่น
  - บน Linux `checkDependencies()` ต้องมี `ripgrep` ด้วย (ใช้หาไฟล์อันตรายใต้ cwd เพื่อห้ามเขียน) ข้อความของ `check()` จึงบอก `bubblewrap socat ripgrep`
  - sandbox-runtime ไม่ตรวจ user namespace ที่ AppArmor ปิด และใน Docker ปกติ bubblewrap ติด `Can't mount proc` `check()` จึงลองรัน `true` ใน sandbox หนึ่งครั้งตอนเริ่ม ถ้าไม่ผ่านพิมพ์ stderr ของ bubblewrap พร้อมวิธีเปิด user namespace ของ Ubuntu 24.04 แล้วจบด้วย exit code 1

## ที่ต่างจากแผนระหว่างทำ

- worker ตั้ง `XDG_CACHE_HOME`, `BUN_INSTALL_CACHE_DIR` กับ `npm_config_cache` ไว้ใต้ `agents/<id>/tmp/cache` เพราะคำสั่งเขียนนอกโฟลเดอร์ของ Agent ไม่ได้ และ package manager จะเขียน cache ใน home (ข้อ 3.4 ใน `manual-checks.md`)
- `egress.set` ที่มีรายการผิดรูปแบบไม่ผ่าน schema ของ Protocol เลย supervisor จึงตอบ `egress.invalid_domain` จากที่ `parseMessage` บอก `invalid` ของ type นี้ ไม่ใช่จากใน slice
- คำสั่ง bash ที่ทิ้งโปรเซสไว้เบื้องหลังถูกหยุดทั้งกลุ่มเมื่อคำสั่งจบ ไม่ใช่แค่เมื่อหมดเวลา เพราะโปรเซสนั้นถือท่อผลไว้ และ Turn จะรอจนหมดเวลา ตัวที่ออกจากกลุ่มไปเอง (`setsid`) อ่านผลต่อได้อีกไม่เกินหนึ่งวินาที
- e2e ข้อ "ต่อด้วยชื่อโดเมนได้หลัง `egress.set`" ใช้ `example.com` จริงแทน Provider ปลอม เพราะ proxy ของ sandbox หาที่อยู่ของโดเมนบนเครื่อง และไม่มีชื่อโดเมนที่ชี้ `127.0.0.1` ได้ทุกเครื่องโดยไม่แก้ `/etc/hosts` e2e จึงต้องมีเน็ต
- Controller มี `inform` ใน `shared/ui` ตาม prototype (alert ของ platform และ `window.alert` บนเว็บ) ให้ส่วน Egress บอกเมื่อ Machine ออฟไลน์หรือโดเมนผิดรูปแบบ

## การตัดสินที่ Owner ให้ไว้

- **bash รันโดยไม่มี Approval** จนกว่า `approval-and-allowlist` จะมา ยอมรับบน `develop` ก่อน v0.1 ซึ่งยังขัดกับ ADR 0030 อยู่ชั่วคราว (ดู Risks) ที่ว่างไว้คือ `ToolRunner` ของ bash ที่ change นั้นห่อด้วยตัวกรองในแกน
- **`daily-budget` มาหลัง change นี้** คำขอ LLM ขาไป Provider ยังอยู่ที่เดียวคือ `handleLlm` ใน `supervisor/proxy/proxy.ts` ให้ `daily-budget` อ่าน `usage` ที่นั่น
- **Egress เริ่มจากว่าง** แก้จากหน้า Machine ด้วย `egress.set` ที่เซ็นแล้ว
- คำถามอื่นใช้ค่าที่เขียนไว้ในเอกสารนี้

## Open Questions

- รายชื่อไฟล์ลับควรให้ Owner เพิ่มเองได้ไหม change นี้ใช้รายชื่อคงที่ ถ้าต้องเพิ่มค่อยทำไฟล์ใน `runtime/` โดยไม่เปลี่ยน spec
