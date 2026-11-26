# allowlist Specification

## Purpose

Allowlist คือรายการสิ่งที่ Agent ตัวหนึ่งทำได้ทันทีโดยไม่ต้องขอ Approval เก็บต่อ Agent ที่ Machine รูปแบบของรายการ กฎการเทียบคำนำหน้า และเส้นทางที่รายการถูกแก้

## Requirements

### Requirement: Allowlist เก็บต่อ Agent เป็นคำนำหน้าของคำสั่งกับชื่อ tool
Allowlist ของ Agent ตัวหนึ่ง SHALL เป็นรายการ string ที่เก็บในไฟล์รายชื่อ Agent ของ supervisor ให้อยู่รอดข้ามการเริ่มใหม่ รายการแต่ละตัว SHALL เป็นคำนำหน้าของคำสั่ง bash หนึ่งบรรทัด (เช่น `npm test`, `git status`) หรือชื่อเต็มของ tool จาก Connector (เช่น `github/create_pull_request`) ที่มี `/` คั่น supervisor SHALL ส่ง Allowlist ของแต่ละ Agent ใน `agent.listed` ทุกครั้ง Controller รุ่นเก่าที่ไม่รู้จัก field นี้ SHALL ข้ามไปตาม ADR 0023

#### Scenario: tool ที่ชื่อตรงรายการรันได้เลย
- **WHEN** Allowlist มี `github/create_pull_request` แล้ว LLM ขอ tool นั้น
- **THEN** tool นั้นรันทันทีโดยไม่มี `approval.requested` ใน log

#### Scenario: tool ที่ไม่มีชื่อในรายการต้องขอ
- **WHEN** Allowlist ไม่มีชื่อ tool ที่ LLM ขอ และ tool นั้นไม่ใช่ tool ไฟล์
- **THEN** log มี `approval.requested` และ tool นั้นยังไม่รันจนกว่าจะได้อนุมัติ

#### Scenario: รายชื่อมี Allowlist
- **WHEN** Controller ขอรายชื่อ Agent ของ Machine ที่มี Allowlist แล้ว
- **THEN** Agent แต่ละตัวใน `agent.listed` มี `allowlist` ที่เป็นรายการที่เก็บไว้

#### Scenario: เริ่มใหม่แล้วยังอยู่
- **WHEN** supervisor เริ่มใหม่ แล้ว Controller ขอรายชื่อ
- **THEN** Allowlist ของแต่ละ Agent เท่าเดิม

### Requirement: กฎเทียบคำนำหน้าทีละคำ
คำสั่งหนึ่งบรรทัด SHALL ผ่านเมื่อทุกรายการเทียบคำนำหน้าแบบทีละคำจากต้นคำสั่งผ่าน รายการ `npm test` SHALL ครอบ `npm test -- --watch` แต่ SHALL NOT ครอบ `npm tester` หรือ `npm testing` การเทียบ SHALL แยกคำด้วยช่องว่าง และ SHALL NOT ตัด flag ทิ้ง รายการ `git status` SHALL NOT ครอบ `git statusx`

#### Scenario: flag เพิ่มยังผ่าน
- **WHEN** Allowlist มี `npm test` แล้ว LLM ขอ `npm test -- --watch`
- **THEN** คำสั่งนั้นผ่านโดยไม่ขอ Approval

#### Scenario: คำที่ยาวกว่าไม่ผ่าน
- **WHEN** Allowlist มี `npm test` แล้ว LLM ขอ `npm tester`
- **THEN** คำสั่งนั้นต้องขอ Approval

### Requirement: คำสั่งที่ต่อกันหลายท่อนต้องผ่านทุกท่อน
คำสั่งที่ต่อกันด้วย `&&`, `;`, `|` หรือ `&` SHALL ถูกแยกเป็นท่อนก่อนเทียบ และ SHALL ผ่านเมื่อทุกท่อนมีคำนำหน้าใน Allowlist ท่อนใดท่อนหนึ่งไม่ผ่าน SHALL ถือว่าทั้งบรรทัดไม่ผ่านและต้องขอ Approval ทั้งบรรทัด `&` ท้ายบรรทัดอย่างเดียว SHALL ไม่เหลือเป็นท่อน (รัน background ของท่อนนั้น)

#### Scenario: ท่อนหนึ่งไม่ผ่าน
- **WHEN** Allowlist มี `git status` แต่ไม่มี `rm -rf dist` แล้ว LLM ขอ `git status && rm -rf dist`
- **THEN** ทั้งบรรทัดต้องขอ Approval

#### Scenario: ทุกท่อนผ่าน
- **WHEN** Allowlist มี `git status` กับ `ls` แล้ว LLM ขอ `git status && ls`
- **THEN** ทั้งบรรทัดรันได้เลย

### Requirement: สิ่งที่แยกท่อนไม่ได้ต้องขอ Approval ทุกครั้ง
คำสั่งที่มี `$(...)`, backtick, การ redirect (`>`, `>>`, `>|`, `>&`, `<`, `<>`, `<<`, heredoc) หรือเรียก `eval` / `exec` เป็นคำแรกของท่อนใดท่อนหนึ่ง (รวม `builtin` / `command` ที่ห่อสองตัวนี้) SHALL ต้องขอ Approval ทุกครั้งแม้ทุกคำตรงกับ Allowlist เพราะแยกท่อนให้แน่ใจไม่ได้ตาม ADR 0030 เครื่องหมายใน quote, หลัง backslash และการเทียบใน `[[ ... ]]` / `(( ... ))` SHALL ไม่นับเพราะข้างในนั้นไม่ใช่คำสั่ง

#### Scenario: command substitution
- **WHEN** Allowlist มี `echo` แล้ว LLM ขอ `echo $(rm -rf dist)`
- **THEN** คำสั่งนั้นต้องขอ Approval

#### Scenario: eval
- **WHEN** Allowlist มี `echo` แล้ว LLM ขอ `eval echo hi`
- **THEN** คำสั่งนั้นต้องขอ Approval

### Requirement: ชุดเริ่มต้นอ่านอย่างเดียวในหน้าสร้าง Agent
Agent ที่สร้างใหม่ SHALL เริ่มจาก Allowlist ว่าง แต่หน้าสร้าง Agent SHALL ติ๊กชุดคำสั่งอ่านอย่างเดียวไว้ให้ ได้แก่ `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `git status`, `git diff`, `git log` Member SHALL เอาออกได้ก่อนเซ็น `agent.create` SHALL มี field `allowlist` ที่ไม่บังคับ และ SHALL เก็บตามที่ส่งมา

#### Scenario: สร้างด้วยชุดเริ่มต้น
- **WHEN** Owner ติ๊กชุดเริ่มต้นค้างไว้แล้วกดสร้าง
- **THEN** Agent ใหม่มี Allowlist เก้ารายการนั้น

#### Scenario: เอาออกก่อนสร้าง
- **WHEN** Owner เอา `cat` ออกก่อนกดสร้าง
- **THEN** Agent ใหม่ไม่มี `cat` ใน Allowlist

### Requirement: แก้ Allowlist ด้วย agent.update ทั้งชุด
`agent.update` SHALL รับ `allowlist` ทั้งชุดเหมือน field อื่น และการเปลี่ยน SHALL มีผลกับคำขอถัดไปของ worker โดยไม่ตัด Turn ที่ทำอยู่ Member ที่มี Manage ที่ Agent นั้น (ใน v0.1 คือ Owner) เท่านั้น SHALL แก้ได้

#### Scenario: ต้องยืนยันตัวก่อนแก้
- **WHEN** Owner เพิ่มหรือลบรายการในหน้า Allowlist
- **THEN** Controller ขอยืนยันตัวก่อนเซ็น และถ้าไม่ผ่านจะไม่มีซองออกไป (ADR 0012)

#### Scenario: เพิ่มรายการ
- **WHEN** Owner ส่ง `agent.update` ที่มี `allowlist` เพิ่ม `npm test` แล้ว LLM ขอ `npm test` ในคำขอถัดไป
- **THEN** คำสั่งนั้นรันได้เลย

#### Scenario: คนที่ไม่มี Manage
- **WHEN** ซอง `agent.update` ที่มี `allowlist` มาจาก Member ที่ไม่มี Manage ที่ Agent นั้น
- **THEN** supervisor ตอบ `agent.unknown` และ Allowlist ไม่เปลี่ยน
