# Veeloe

ระบบ Agent ที่ติดตั้งลงหลายเครื่อง Agent บนเครื่องเดียวกันทำงานร่วมกันใน Project ได้ และสั่งการได้จากทุกที่ผ่านแอปมือถือ

## Language

### ที่อยู่และความไว้ใจ

**Workspace**:
ขอบเขตความเป็นเจ้าของ Machine และ Agent ทุกตัวเป็นของ Workspace เดียว และมองไม่เห็นของ Workspace อื่น คนคนหนึ่งเป็น Member ได้หลาย Workspace โดยใช้กุญแจแยกกันในแต่ละที่ และไม่มีตัวตนกลางที่โยงข้าม Workspace
_Avoid_: Account, tenant, organization

**Machine**:
คอมพิวเตอร์หนึ่งเครื่องที่ติดตั้ง Runtime ไว้
_Avoid_: Node, host, device

**Runtime**:
โปรแกรมที่ติดตั้งบน Machine เป็นที่อยู่ของ Agent บนเครื่องนั้น
_Avoid_: Daemon, client, worker

**Member**:
คนหนึ่งคนที่อยู่ใน Workspace และมี Grant ต่อ Agent แต่ละตัว ระบบรู้จัก Member จากรหัส เช่น `m_kai` ไม่ใช่จากชื่อ ชื่อที่แสดงตั้งโดย Owner ตอน Invitation แล้ว Member เปลี่ยนเองหรือให้ Owner เปลี่ยนได้ด้วยคำสั่งที่เซ็น ห้ามซ้ำกับคนอื่นใน Workspace และ Hub เก็บไว้เป็น metadata Controller แต่ละเครื่องมีชื่อเครื่องของตัวเองไว้ใช้ตอนถอนกุญแจ
_Avoid_: User, account, seat

**Owner**:
Member ที่ทำ Pairing ได้ สร้าง Agent ได้ เพิ่มหรือลบ Member ได้ และแจก Grant ได้ มีสิทธิ์ Manage กับ Agent ทุกตัว และกุญแจของ Owner คือจุดเริ่มต้นของความไว้ใจทั้ง Workspace Workspace มี Owner ได้หลายคน Owner เลื่อน Member คนอื่นขึ้นเป็น Owner หรือปลด Owner คนอื่นได้ แต่ Owner คนสุดท้ายออกจาก Workspace ไม่ได้
_Avoid_: Admin, root

**Grant**:
สิทธิ์ที่ Member มีต่อ Agent ตัวหนึ่ง มีสามระดับคือ Use (สั่งงาน และเปิดดู Task ของ Agent นั้นที่คนเริ่มเปิดให้เห็น), Approve (ตอบ Approval) และ Manage (แก้ค่า Agent, Allowlist, Egress, ใส่หรือเอา Agent ตัวนี้ออกจาก Project หรือ Team และตั้ง Agent ตัวนี้เป็น Entry ของ Team) นอก Project Turn ของคนที่มี Manage อ่านไฟล์บนเครื่องได้ทุกไฟล์ที่ไม่ใช่ไฟล์ลับ ส่วน Turn ของคนที่มีแค่ Use หรือ Approve อ่านได้แค่ Workdir กับ Library ส่วนสิทธิ์ต่อ Project มีสี่ระดับคือ View (เห็น Task และ wiki ของ Project), Ask (ถามได้), Use (สั่งงานและกด Stop) และ Manage (ให้สิทธิ์ใน Project จัดรายชื่อผู้ทำงาน และตั้งค่าของ Project) Owner มี Manage ของทุก Project ใน Project ใช้สิทธิ์ของ Project นอก Project ใช้สิทธิ์ของ Agent แต่ Approval ไปที่คนที่มี Approve ที่ Agent ตัวนั้นเสมอ ระดับที่สูงกว่าได้สิทธิ์ของระดับที่ต่ำกว่าด้วย
_Avoid_: Role, permission, ACL

**Controller**:
แอปที่ Member คนหนึ่งติดตั้งบนมือถือหรือเบราว์เซอร์และได้รับความไว้ใจจาก Workspace คำสั่งทุกอย่างต้องมาจาก Controller และถือว่าเป็นคำสั่งของ Member เจ้าของ Controller นั้น ข้อยกเว้นเดียวคือข้อความในแชตของ Channel ซึ่งทำในนามของ Member ที่ผูก Channel นั้นไว้ กุญแจของ Controller ใช้ได้หลังยืนยันตัว บนมือถือด้วย Face ID หรือลายนิ้วมือ และบนเว็บด้วย passkey ตอนเปิดแอปและหลังไม่ได้ใช้เกิน 5 นาที และต้องยืนยันใหม่ทุกครั้งก่อนอนุมัติ Approval, Link เครื่อง, เปลี่ยน Grant หรือ Owner, ติดตั้ง Skill, Connector หรือ Blueprint, แก้ Allowlist หรือ Egress, Pairing, ปล่อย Machine และถอนกุญแจ
_Avoid_: Device, client, phone, app

**Demo Workspace**:
Workspace ตัวอย่างที่อยู่บน Controller อย่างเดียว ไม่ต่อ Hub ใช้ event ตัวอย่างที่ฝังมากับแอป ให้ลองทุกฟีเจอร์ได้โดยไม่ต้องมี Machine คำสั่งที่กดในนี้ไม่ถูกส่งไปที่ไหน
_Avoid_: Demo account, sandbox mode, guest mode

**Pairing**:
การผูก Machine ใหม่เข้ากับ Workspace ด้วยรหัสใช้ครั้งเดียวจาก QR บนจอ Machine ซึ่ง Hub ไม่เคยเห็น ถ้า Owner ของ Workspace เดิมเซ็นปล่อย Machine ไว้ก่อน Pairing ครั้งใหม่จะพา Agent, Workdir, Project และประวัติ Task ไปด้วย แต่ Grant ทั้งหมดถูกล้าง และ Schedule กับ Channel หยุด คำสั่งปล่อยใช้ได้กับ Pairing ครั้งถัดไปครั้งเดียว หมดอายุใน 7 วัน และ Owner คนไหนก็ยกเลิกได้ ระหว่างนั้น Machine ยังทำงานใน Workspace เดิม ถ้าไม่ได้ปล่อยไว้ Machine จะเริ่มใหม่จากศูนย์
_Avoid_: Registration, enroll

**Linking**:
การเพิ่ม Controller เครื่องใหม่ของ Member คนเดิม โดยให้ Controller ที่ได้รับความไว้ใจอยู่แล้วแสดง QR ที่มี Hub ของตัวเอง ให้เครื่องใหม่สแกนหรือเปิดลิงก์ แล้วอนุมัติคำขอที่เครื่องใหม่ส่งกลับมา ทาง QR ไม่ต้องเทียบรหัสสั้น เพราะรหัสลับเดินทางจากจอไปที่กล้องตรงๆ ไม่ผ่าน Hub และคำขอผูกกุญแจใหม่ไว้กับรหัสลับนั้น หรือให้เครื่องใหม่ login ด้วย email ที่ Hub เพื่อส่งคำขอไปที่เครื่องเดิม แล้วอนุมัติบนเครื่องเดิมหลังเทียบรหัสสั้นตรงกัน login ที่ Hub มีไว้ให้เครื่องใหม่หาเจ้าของเจอเท่านั้น ไม่ได้รับรองว่าเป็นใคร คนรับรองคือเครื่องเดิมที่เซ็นกุญแจใหม่ เครื่องใหม่จะสั่งงานได้ก็ต่อเมื่อผ่าน Linking หรือ Invitation เท่านั้น
_Avoid_: Login, sign-in, device registration

**Invitation**:
การเพิ่ม Member ใหม่เข้า Workspace จากที่ไกล Owner หรือ Member ที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัวส่งลิงก์ที่ใช้ได้ครั้งเดียวไปให้ ลิงก์แนบ Grant มาด้วยได้ เฉพาะ Agent ที่คนออกมี Manage แล้วทั้งสองฝั่งเทียบรหัสสั้นที่คำนวณจากกุญแจของคนที่ถูกเชิญ ก่อนที่คนออกจะเซ็นรับรอง รหัสที่ไม่ตรงกันแปลว่ามีคนสลับกุญแจระหว่างทาง ถ้าคนออกไม่ใช่ Owner Runtime ของ Agent ที่แนบ Grant ต้องตรวจ Manage ก่อน
_Avoid_: Signup, registration, join link, share link

**Revocation**:
การถอนกุญแจของ Controller เครื่องหนึ่ง ทำได้โดยเจ้าของจากเครื่องอื่นของตัวเอง หรือโดย Owner และการลบ Member คือการถอนกุญแจทุกเครื่องของคนนั้น Hub ตัดสายของกุญแจนั้นทันที และ Runtime จดไว้เองตอนต่อเข้ามาครั้งถัดไป ของที่เซ็นด้วยกุญแจนั้นแล้วทำงานเอง ได้แก่ Schedule, Idle Work, Watch และ Channel หยุดตามไปด้วย ถอนกุญแจดอกไหนมีผลแค่เครื่องนั้น เพราะใบรับรองของ Linking ผูกกับ Member ไม่ได้ผูกกับเครื่องที่เซ็น คำสั่งถอนระบุใบรับรองที่กุญแจดอกนั้นเคยเซ็นและยังยอมรับ ใบอื่นจากกุญแจดอกนั้นใช้ไม่ได้
_Avoid_: Logout, ban, block, unlink

**Hub**:
บริการกลางที่เรา host ส่งต่อข้อความระหว่าง Controller กับ Runtime ไม่รัน Agent และไม่ถือ key ของ LLM Hub ไม่รู้ Grant และส่งต่อตามรายชื่อผู้รับที่ Runtime ใส่ไว้ในหัวซอง
_Avoid_: Server, gateway, relay, broker

**Protocol**:
ภาษากลางที่ Controller, Runtime และ Hub ใช้คุยกัน กำหนดว่าซอง ข้อความ และ event หน้าตาเป็นยังไง และต้องเซ็นยังไง เปิดให้คนอื่นใช้สร้าง Hub หรือ Controller ของตัวเองได้
_Avoid_: API, SDK, contract

### Agent และงาน

**Agent**:
ตัวทำงานที่ใช้ LLM ตัดสินใจแล้วลงมือทำผ่าน tool อยู่บน Machine เดียวตลอดและแตะได้แค่สิ่งที่เครื่องนั้นมี ทำได้ทีละ Turn ยกเว้น Turn ที่อยู่คนละ Worktree ซึ่งรันพร้อมกันได้ Machine หนึ่งมีได้หลาย Agent
_Avoid_: Bot, worker

**Character**:
ตัวละครประจำตัวของ Agent ตัวหนึ่ง ใช้แสดงอารมณ์ผ่านท่าทางบน Controller เป็นแค่หน้าตา ไม่มีผลกับคำพูดหรือการทำงานของ Agent
_Avoid_: Avatar, persona, mascot

**Mood**:
ท่าทางที่ Character กำลังแสดงอยู่ ได้มาจากสถานะของ Agent และเหตุการณ์ใน Task เช่น ยกมือตอนรอ Approval หรือดีใจตอน Task เสร็จ LLM ไม่ได้เป็นคนเลือก
_Avoid_: Emotion, expression, animation

**Workdir**:
โฟลเดอร์บน Machine ที่ Agent ตัวหนึ่งเขียนไฟล์ได้ นอกโฟลเดอร์นี้เขียนไม่ได้ Runtime สร้างให้เองในโฟลเดอร์ของ Runtime และ Member เลือกที่อยู่เองไม่ได้ ถ้าจะทำงานกับ repo ที่มีอยู่แล้ว ให้ Agent clone เข้ามา Agent ที่อยู่ Project เดียวกันอ่าน Workdir ของกันได้เฉพาะตอนทำ Task ของ Project นั้น และเขียนของกันไม่ได้
_Avoid_: Workspace, sandbox

**Skill**:
คู่มือวิธีทำงานเรื่องหนึ่งที่ติดตั้งให้ Agent เป็นโฟลเดอร์ที่มี `SKILL.md` และอาจมี script ประกอบ Agent เห็นแค่ชื่อกับคำอธิบายของทุก Skill แล้วเปิดอ่านเต็มเมื่องานตรงกับ Skill นั้น Member ที่มี Manage เป็นคนติดตั้ง แก้ หรือลบด้วยคำสั่งที่เซ็น Agent อ่านได้แต่แก้ไม่ได้ และเสนอร่าง Skill ไว้ใน Workdir ให้ Member ติดตั้งได้
_Avoid_: Plugin, tool, prompt template

**Blueprint**:
แม่แบบของ Agent ที่คนอื่นทำมาให้ติดตั้ง มีคำสั่งของ Agent, Skill, รายชื่อ Connector ที่ต้องใช้, Allowlist กับ Egress ที่แนะนำ และ Character ตอนติดตั้ง แอปแสดงว่าขออะไรบ้าง แล้ว Member ที่มี Manage เซ็นทับ hash แบบเดียวกับ Skill ผลที่ได้คือ Agent ปกติหนึ่งตัวที่ใช้ Provider และ Budget ของลูกค้าเอง ส่วนขยายจากคนอื่นมีแค่ Skill, Connector และ Blueprint ไม่มี plugin ที่รันอยู่ใน Runtime ยังไม่ได้ทำ และจะมาพร้อม marketplace หลัง v0.3
_Avoid_: Plugin, template, preset, package

**Connector**:
บริการภายนอกที่ต่อเข้ากับ Agent ผ่าน MCP ถ้าเป็นบริการบนเน็ต supervisor เป็นคนต่อและถือ credential ไว้เอง Agent เห็นแค่ tool และอ่าน credential ไม่ได้ ถ้าเป็นโปรแกรมบนเครื่อง จะรันใน sandbox ของ Agent และไม่ถือความลับ Connector หนึ่งตัวใช้บัญชีเดียว ซึ่งคนที่มี Manage เป็นคนผูก ใครที่มี Use ที่ Agent ก็ใช้บัญชีนั้นผ่าน Agent ได้ Member ผูกบัญชีของตัวเองเพิ่มได้ บัญชีนั้นใช้ได้เฉพาะ Turn ที่คนนั้นเป็นคนส่งข้อความ และใช้ใน Channel ไม่ได้ Connector หยุดทันทีเมื่อกุญแจที่เซ็นมันถูกถอน แบบเดียวกับ Schedule และ Channel ถ้าลบ Member แล้ว Owner ไม่ได้เซ็นใหม่ supervisor จะลบ credential ทิ้ง tool ของ Connector ถูกตรึงไว้ตั้งแต่ตอนติดตั้ง ถ้า server เปลี่ยนหรือเพิ่ม tool ต้องอนุมัติใหม่
_Avoid_: Integration, plugin, MCP server, borrowed account

**Memory**:
ไฟล์ `MEMORY.md` ใน Workdir ที่ Agent จดสิ่งที่ทุก Task ต้องรู้ Runtime ใส่เข้า prompt ตอนเริ่ม Task และตรึงไว้ทั้ง Task มีเพดาน 4,000 ตัวอักษร และ Agent แก้เองได้ เรื่องที่ไม่ต้องรู้ทุกครั้ง Agent ค้นเอาจาก Task เก่าของตัวเอง ส่วนความรู้ที่ใช้ร่วมกันหลาย Agent อยู่ใน Library
_Avoid_: Knowledge, notes, context

**Library**:
คลังความรู้บน Machine ที่แยกออกจาก Workdir ของ Agent Owner เป็นคนสร้าง และกำหนดว่า Agent ตัวไหนอ่านได้ และตัวไหนเป็นตัวเดียวที่เขียนได้ Agent หลายตัวจึงใช้ความรู้ชุดเดียวกันได้โดยไม่มีใครแก้ทับกัน ใครที่มี Use ที่ Agent ที่อ่าน Library ได้ ก็ขอดูเนื้อหาของ Library ผ่าน Agent นั้นได้ Library อยู่บน Machine เดียว และเป็นไฟล์ Markdown ที่ลิงก์กันด้วย `[[...]]` ซึ่ง Obsidian เปิดดูเป็นกราฟได้
_Avoid_: Knowledge base, vault, wiki, memory

**Egress**:
รายชื่อโดเมนที่ Agent ตัวหนึ่งออกไปได้ Agent แต่ละตัวมีของตัวเอง ไม่มีรายชื่อกลางของ Machine จะตั้งให้ออกได้ทั้งเน็ตสาธารณะก็ได้ ซึ่งไม่รวมที่อยู่ภายใน และระหว่างที่ตั้งแบบนั้น Agent อ่านไฟล์ได้แค่ใน Workdir ของตัวเองกับ Library ที่ได้สิทธิ์ เป็นคนละเรื่องกับ Allowlist
_Avoid_: Network allowlist, whitelist, firewall rules

**Allowlist**:
รายการสิ่งที่ Agent ตัวหนึ่งทำได้ทันทีโดยไม่ต้องขอ Approval มีสองแบบ คือคำนำหน้าของคำสั่ง bash เช่น `npm test` และชื่อเต็มของ tool จาก Connector เช่น `github/create_pull_request` คำสั่งที่ต่อกันหลายท่อนต้องผ่านทุกท่อน ส่วน tool ที่ทำกับไฟล์ไม่ต้องผ่าน Allowlist เพราะ sandbox คุมอยู่แล้ว ทุกรายการมาจากการที่ Member เซ็นเพิ่ม ไม่มีอะไรที่ผ่านเสมอโดยไม่อยู่ในรายการ สำหรับ bash Allowlist กันความผิดพลาด ไม่ได้กัน Agent ที่โดนหลอกให้เลี่ยง กำแพงจริงคือ sandbox กับ Egress แต่สำหรับ tool ของ Connector Allowlist เป็นกำแพงจริง เพราะ supervisor เป็นคนบังคับ
_Avoid_: Permissions, whitelist, rules

**Approval**:
คำขอที่ Agent ส่งไปให้ Member ที่มี Grant ระดับ Approve อนุมัติก่อนทำสิ่งที่ไม่อยู่ใน Allowlist ระหว่างนั้น Task จะหยุดรอจนกว่าจะได้คำตอบ หรือจนกว่า Approval จะหมดอายุตามเวลาที่ตั้งไว้ใน Agent (ค่าเริ่มต้น 1 ชั่วโมง) ซึ่งจะนับว่าถูกปฏิเสธ Member ที่มี Manage เลือกอนุญาตตลอดได้ ซึ่งจะเพิ่มคำนำหน้าของคำสั่งนั้นเข้า Allowlist ไปพร้อมกัน คนที่มี Approve เปิดอ่าน Task ที่ขออนุมัติได้เมื่อต้องการ และการเปิดถูกบันทึกไว้ใน Task
_Avoid_: Confirmation, consent, prompt

**Budget**:
จำนวน token ต่อวันที่ Agent ตัวหนึ่งใช้ได้ นับทุก token ที่ Provider รายงาน ทั้ง input ที่รวมส่วนที่อ่านจาก cache และ output ค่าเริ่มต้น 10M token คนที่มี Manage เป็นคนตั้ง และ Runtime เป็นคนบังคับ วันใหม่เริ่มตอน 04:00 ตามเวลาของ Machine ถ้าหมด Turn ที่ทำอยู่จะจบเหมือนโดน Stop และงานใหม่ไม่เริ่มจนกว่าจะขึ้นวันใหม่หรือมีคนเพิ่ม Budget Idle Work กับงานที่เริ่มจาก event ในเครื่องใช้ได้ไม่เกินเพดานที่คนที่มี Manage ตั้ง ค่าเริ่มต้น 30% ของ Budget ส่วนงานอื่นใช้ได้เต็ม Budget ทุกคนที่ใช้ Agent ตัวนั้นใช้ Budget ก้อนเดียวกัน ค่า token เข้า key ของ Provider ที่ตั้งบน Machine และแอปแสดงว่าแต่ละ Member ใช้ไปเท่าไหร่ในแต่ละเดือน ส่วนการแบ่งค่าใช้จ่ายระหว่างคนเป็นเรื่องนอกระบบ
_Avoid_: Quota, limit, credit

**Task**:
บทสนทนาหนึ่งเรื่องระหว่าง Member กับ Agent ตัวหนึ่ง หรือกับ Team หนึ่ง จะทำงานใน Project หรือไม่ก็ได้ ยกเว้น Team ที่ต้องอยู่ใน Project คุยต่อได้หลายข้อความ Agent ที่ได้รับเป็นเจ้าของ Task นั้น ส่วน Task ของ Project เป็นของ Agent ที่เป็นผู้ทำงาน หรือของ Entry ถ้าผู้ทำงานคือ Team ถ้า Task ยาวจนใกล้เพดาน context Runtime ย่อสิ่งที่ส่งให้ LLM เป็นบทสรุปก้อนเดียว แต่ประวัติใน Task ยังอยู่ครบ Task ที่ Member เริ่มคุยกับ Agent ในแอปเปิดดูได้เฉพาะคนเริ่ม จนกว่าคนเริ่มจะเปิดให้คนที่มี Use เห็น ซึ่งย้อนกลับไม่ได้ เรื่องนี้ทำให้แอปไม่รก ไม่ได้ทำให้เป็นความลับ เพราะ Workdir กับ Memory ใช้ร่วมกัน และเจ้าของ Machine เข้าถึงได้ Agent ค้น Task ของคนอื่นตอนคุยผ่าน Controller ได้ เว้นแต่คนที่มี Manage ปิดไว้ ค่านี้ตรึงตอนเริ่มแต่ละ Task Task ของ Project ไม่อยู่ในกฎนี้
_Avoid_: Chat, thread, session, job, run, room, Private Task

**Attachment**:
ไฟล์ที่แนบมากับข้อความใน Task ทั้งจาก Member ไปหา Agent และจาก Agent กลับมาด้วย tool `send_file` ไฟล์ละไม่เกิน 20MB ข้อความที่เซ็นแล้วประกาศชื่อ ขนาด และ hash ของไฟล์ก่อน แล้วตัวไฟล์ตามมาเป็นซอง `file.chunk` ก้อนละ 256KB ผ่าน Hub ซึ่งส่งต่ออย่างเดียวไม่เก็บ Runtime รับเฉพาะก้อนที่ประกาศไว้และเทียบ hash ก่อนเริ่ม Turn ไฟล์ที่ Agent ส่งกลับ Controller ดึงมาเมื่อกดเปิดด้วยคำขอที่เซ็น event log เก็บแค่ชื่อ ขนาด hash และ path
_Avoid_: Upload, file message

**Turn**:
ช่วงที่ Agent ลงมือทำงานเพื่อตอบข้อความหนึ่งข้อความใน Task ทำในนามของคนที่ส่งข้อความนั้น ซึ่งไม่จำเป็นต้องเป็นคนที่เริ่ม Task เพราะ Member หลายคนพิมพ์ใน Task เดียวกันได้ เริ่มเมื่อได้รับข้อความ และจบเมื่อ Agent ตอบเสร็จหรือถูก Stop ระหว่าง Turn รวมถึงตอนรอ Approval Agent จะไม่ว่าง ส่วน Task ที่เปิดค้างไว้ไม่ได้ถือ Agent ถ้า worker หรือ Runtime เริ่มใหม่กลาง Turn Turn นั้นจบเหมือนโดน Stop และไม่ทำต่อเอง
_Avoid_: Run, step, iteration

**Schedule**:
ข้อความที่ Member ตั้งเวลาไว้และเซ็น ให้ Runtime เปิดเป็น Task ใหม่กับ Agent หรือกับผู้ทำงานใน Project ทุกรอบ ทำในนามของ Member ที่ตั้ง ตอนตั้งเลือกได้ว่าเรื่องที่ Agent บอกจะแจ้งแค่คนตั้ง หรือทุกคนที่มี Use ที่ Agent นั้น และถ้าไม่มีอะไรต้องบอก Agent จบ Turn แบบไม่แจ้งใคร Task ของรอบนั้นก็ไม่ขึ้นใน Inbox ถ้า Machine ปิดอยู่ตอนถึงเวลา รอบที่พลาดรันชดเชยครั้งเดียวตอนเครื่องกลับมา ไม่ว่าจะพลาดกี่รอบ และ Agent ได้รู้ว่ารอบนั้นควรรันตอนกี่โมง Schedule หยุดทันทีเมื่อกุญแจของ Controller ที่เซ็นมันถูกถอน ซึ่งรวมถึงตอนที่ Member คนนั้นถูกลบ
_Avoid_: Heartbeat, cron, automation, routine, trigger

**Idle Work**:
งานในลิสต์ที่ Member เซ็นไว้ให้ Agent ตัวหนึ่งทำเอง เมื่อไม่มี Turn กำลังทำ คิวว่าง และเงียบครบเวลาที่ตั้ง ทำในนามของคนเซ็น ข้อความที่เข้ามาระหว่างนั้นต่อคิวตามปกติ ไม่ขัดงานกลางคัน และงานหนึ่งชิ้นมีเพดานเวลา
_Avoid_: Background job, heartbeat, daemon

**Watch**:
คำสั่งที่ Member เซ็นไว้ให้ Agent ตัวหนึ่งเปิด Task เมื่อไฟล์เปลี่ยนหรือมีไฟล์ใหม่ ในที่ที่คนตั้งอ่านได้ ทำในนามของคนตั้ง การเปลี่ยนแปลงถี่ๆ รวมเป็นงานเดียว การเขียนของ Agent เองไม่นับ และถ้าไฟล์เปลี่ยนตอนเครื่องปิด งานเริ่มครั้งเดียวตอนเครื่องกลับมา
_Avoid_: Trigger, listener, automation

**Channel**:
แชตภายนอก เช่น กลุ่ม Telegram ที่ Member ผูกเข้ากับ Agent ตัวหนึ่งและเซ็นไว้ ใครในแชตนั้นก็คุยกับ Agent ได้ และงานที่เกิดขึ้นทำในนามของ Member ที่ผูก การผูกเริ่มจากแอป หรือเริ่มจากแชตด้วย `/claim` ซึ่งใครในแชตพิมพ์ได้ แล้วคนที่มี Manage กรอกรหัสที่ bot แสดงในแชตก่อนเซ็น แต่ละแชตที่ผูกมี Task ของวันละหนึ่ง Task ข้อความที่เรียก Agent ทั้ง mention และ reply เข้า Task ของวันนั้น ข้อความแรกหลังเวลาตัดวันเปิด Task ใหม่ เวลาตัดวันเป็นเวลาของ Machine ค่าเริ่มต้น 04:00 ตั้งได้ต่อ Channel และใครในแชตก็พิมพ์ `/new` หรือ `/reset` เพื่อเปิด Task ใหม่ได้ ในแอป Task ของ Channel อ่านได้อย่างเดียว Member กด Stop และตอบ Approval ได้ แต่พิมพ์ลงไปไม่ได้ คนในแชตไม่ได้เป็น Member มีอำนาจเท่ากันหมด และตอบ Approval ไม่ได้ Agent ที่มี Channel อยู่ใน Project ไม่ได้ และอ่านไฟล์ได้แค่ใน Workdir ของตัวเองกับ Library ที่ได้สิทธิ์ ระหว่างตอบแชต Agent ค้นได้แค่ Task ของแชตนั้น เว้นแต่คนที่มี Manage เปิดให้ค้น Task อื่น Channel หยุดทันทีเมื่อกุญแจของ Controller ที่เซ็นมันถูกถอน แบบเดียวกับ Schedule
_Avoid_: Integration, connector, gateway, bot

**Stop**:
การสั่งให้ Turn ที่กำลังทำอยู่จบทันที พร้อมกับ Turn ของ Task ย่อยทั้งหมดที่อยู่ใต้ Task นั้น ไฟล์ที่แก้ไปแล้วคงสภาพเดิม และ Task ยังคุยต่อได้ Member ที่มี Use กับ Agent ตัวไหน กด Stop ได้ทุก Turn ของ Agent ตัวนั้น ไม่ว่าใครเป็นคนสั่ง ยกเว้น Turn ใน Task ที่คนเริ่มยังไม่ได้เปิดให้เห็น ซึ่งกดได้เฉพาะคนเริ่มกับคนที่มี Manage ส่วนใน Project คนที่มี Use ของ Project กด Stop ได้
_Avoid_: Cancel, abort, kill, close

### Project

**Project**:
ที่ทำงานหนึ่งแห่งบน Machine เดียว มี repo หรือไฟล์งาน มี Library ของตัวเองเป็น wiki มีสิทธิ์ของ Member สี่ระดับ และมีรายชื่อผู้ทำงานที่อนุญาต Task ของ Project แต่ละ Task มีผู้ทำงานหนึ่งราย การเอาผู้ทำงานเข้ารายชื่อต้องมี Manage ของ Project และ Manage ที่ Agent ทุกตัวของผู้ทำงานนั้น ซึ่งเท่ากับยินยอมให้ Agent รับงานจากคนที่มีสิทธิ์ใน Project ผู้ทำงานเขียน repo ได้ระหว่างทำ Task ของ Project และ wiki มีคนเขียนได้ตัวเดียว ถ้าเป็นงานที่ไม่ใช่โค้ด Runtime สร้าง repo ไฟล์งานให้เองบนเครื่อง ตอนสร้าง Project เลือกแม่แบบได้ เช่น โค้ด เอกสาร ดีไซน์ หรืองานผ่านระบบอื่น ซึ่งเป็นแค่ค่าตั้งต้นที่แก้ทีหลังได้ Member ที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัวสร้าง Project ได้ และได้ Manage ของ Project นั้น
_Avoid_: Chat room, swarm, crew, squad, group

**ผู้ทำงาน**:
Agent ตัวเดียวหรือ Team ที่รับงานใน Task ของ Project
_Avoid_: Worker, assignee

**Team**:
กลุ่ม Agent บน Machine เดียวที่มี Entry ตัวเดียวและมีเพดานการส่งงาน Team หนึ่งเข้าได้หลาย Project และทำงานได้เฉพาะใน Project สมาชิกของ Team เรียกว่าพนักงาน Agent ตัวหนึ่งอยู่ได้หลาย Team ยกเว้น Agent ที่มี Channel การเพิ่ม Agent เข้า Team ต้องมี Manage ที่ Agent ตัวนั้น ซึ่งเท่ากับยินยอมให้รับงานในทุก Project ที่ Team นั้นเข้าอยู่
_Avoid_: Swarm, crew, squad, group

**Worktree**:
สำเนาของทุก repo ของ Project ที่ Task หนึ่งได้ไปเมื่อติ๊กไว้ตอนเปิด Task อยู่ใน branch ชื่อเดียวกัน worktree หนึ่งมีคนเขียนได้ทีละหนึ่ง Turn Agent รัน Turn ที่อยู่คนละ worktree พร้อมกันได้ และระหว่างนั้น Workdir ของ Agent อ่านได้อย่างเดียว Task ที่ไม่ติ๊กใช้ checkout หลักร่วมกัน ทีละหนึ่ง Turn ส่วน Project ที่ไม่มี repo ให้ Task ได้โฟลเดอร์ว่างของตัวเองแทน ซึ่งใช้กฎเดียวกัน แต่ไม่ต้องรวมงานกลับ
_Avoid_: Branch, copy, sandbox

**Entry**:
พนักงานของ Team ที่รับข้อความของ Member ใน Task ของ Team นั้น และส่งงานต่อให้พนักงานตัวอื่นในทีมได้ทุกตัว Team หนึ่งมี Entry ตัวเดียว
_Avoid_: Lead, leader, manager, orchestrator

**Delegation**:
การที่ Entry ใน Task ของ Team สร้าง Task ย่อยส่งให้พนักงานตัวอื่น หรือส่งข้อความต่อใน Task ย่อยเดิม เช่น ตีงานกลับให้แก้ ส่งได้ชั้นเดียว พนักงานส่งต่ออีกไม่ได้ และใน Turn หนึ่งส่งได้ไม่เกินเพดานของ Team ซึ่งค่าเริ่มต้นคือ 5 ครั้ง ส่วนจะส่งให้ใครเมื่อไหร่ Entry ตัดสินใจเองจากคำอธิบายของพนักงาน ทำในนามของ Member ที่ส่งข้อความของ Turn ต้นทางเสมอ การส่งงานของทุก Team บนเครื่องเดียวกันรวมกันแล้วห้ามเป็นวง พนักงานสั่งงานกันเองไม่ได้ แต่ถามกันได้ด้วย Ask
_Avoid_: Handoff, dispatch, Flow

**Ask**:
คำถามใน Project ที่ตอบด้วย Turn แบบอ่านอย่างเดียว คนถามคือ Member ที่มีสิทธิ์ Ask ขึ้นไปใน Project หรือพนักงานด้วยกัน คนตอบคือเจ้าของ Task หรือพนักงานที่ถูก Mention Turn แบบนี้มีแค่ tool อ่านไฟล์ ค้น Task ของ Project และอ่าน wiki ไม่มี bash ไม่ส่งงานต่อ และไม่เรียก Connector จึงไม่ต้องรอคิว path ที่ Project ห้ามและ Task ที่ปิดจาก Ask อ่านไม่ได้ ส่วนหัวข้อที่ห้ามตอบเป็นแค่คำขอที่ LLM อาจไม่ทำตาม นอก Project Member ที่มี Use ถาม Agent ที่ไม่ว่างด้วย Ask แทนการต่อคิวได้
_Avoid_: Query, read-only mode

**Mention**:
การแท็กด้วย @ ใน Task ของ Project Mention คนจะส่ง push ให้คนนั้น และทั้ง Member และ Agent Mention คนที่มีสิทธิ์ใน Project ได้ Mention พนักงานในข้อความสั่งงานเป็นการบอก Entry ว่าอยากให้ตัวนั้นทำ ส่วนใน Ask เป็นการถามพนักงานตัวนั้นตรงๆ ถ้า Agent Mention คนเดิมซ้ำใน Task เดิมขณะที่ Mention ก่อนหน้ายังไม่ถูกอ่าน จะไม่ส่ง push ซ้ำ
_Avoid_: Tag, ping

**Subagent**:
ตัวช่วยชั่วคราวที่ Agent สร้างขึ้นเองระหว่างทำ Task อยู่บน Machine เดียวกับ Agent แม่ มีแค่ tool read, glob และ grep จึงอ่านได้อย่างเดียว ส่ง Delegation ไม่ได้ ไม่มี Character และหายไปทันทีที่ส่งคำตอบกลับ ไม่ได้สร้าง Task ใหม่
_Avoid_: Helper, child agent, worker

### LLM

**Provider**:
ปลายทาง LLM ที่ Runtime เรียกใช้ กำหนดด้วย URL กับ key ของลูกค้า เช่น Anthropic, OpenRouter หรือ OpenCode Zen Owner ตั้ง Provider ไว้ที่ Machine และเครื่องหนึ่งมีได้หลายตัว supervisor ถือ key และเป็นทางผ่านของทุกคำขอไป LLM Agent จึงไม่เห็น key Agent แต่ละตัวใช้ Provider ตัวเดียวกับ model เดียวจากเครื่องนั้น ซึ่งคนที่มี Manage เป็นคนเลือก ถ้าเปลี่ยน จะมีผลตั้งแต่ Task ถัดไป ยกเว้น Task ที่ Provider ซึ่งมันใช้อยู่ถูกลบออกจาก Machine แล้ว ซึ่งย้ายไปใช้ Provider กับ model ปัจจุบันของ Agent เพราะ Provider เดิมตอบไม่ได้อยู่แล้ว
_Avoid_: Vendor, backend, model
