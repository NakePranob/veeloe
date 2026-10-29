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
คนหนึ่งคนที่อยู่ใน Workspace และมี Grant ต่อ Agent แต่ละตัว
_Avoid_: User, account, seat

**Owner**:
Member ที่ทำ Pairing ได้ สร้าง Agent ได้ เพิ่มหรือลบ Member ได้ และแจก Grant ได้ มีสิทธิ์ Manage กับ Agent ทุกตัว และกุญแจของ Owner คือจุดเริ่มต้นของความไว้ใจทั้ง Workspace Workspace มี Owner ได้หลายคน Owner เลื่อน Member คนอื่นขึ้นเป็น Owner หรือปลด Owner คนอื่นได้ แต่ Owner คนสุดท้ายออกจาก Workspace ไม่ได้
_Avoid_: Admin, root

**Grant**:
สิทธิ์ที่ Member มีต่อ Agent ตัวหนึ่ง มีสามระดับคือ Use (สั่งงานและดู Task ทุกตัวของ Agent นั้น ไม่ว่าใครเป็นคนเริ่ม), Approve (ตอบ Approval) และ Manage (แก้ค่า Agent, Allowlist, Egress, ใส่หรือเอา Agent ตัวนี้ออกจาก Project และตั้ง Agent ตัวนี้เป็น Entry ของ Project) ส่วนสิทธิ์ต่อ Project มีสี่ระดับคือ View (เห็น Task และ wiki ของ Project), Ask (ถามได้), Use (สั่งงานและกด Stop) และ Manage (ให้สิทธิ์ใน Project ตั้ง Entry และตั้งค่าของ Project) ใน Project ใช้สิทธิ์ของ Project นอก Project ใช้สิทธิ์ของ Agent แต่ Approval ไปที่คนที่มี Approve ที่ Agent ตัวนั้นเสมอ ระดับที่สูงกว่าได้สิทธิ์ของระดับที่ต่ำกว่าด้วย
_Avoid_: Role, permission, ACL

**Controller**:
แอปที่ Member คนหนึ่งติดตั้งบนมือถือหรือเบราว์เซอร์และได้รับความไว้ใจจาก Workspace คำสั่งทุกอย่างต้องมาจาก Controller และถือว่าเป็นคำสั่งของ Member เจ้าของ Controller นั้น ข้อยกเว้นเดียวคือข้อความในแชตของ Channel ซึ่งทำในนามของ Member ที่ผูก Channel นั้นไว้
_Avoid_: Device, client, phone, app

**Demo Workspace**:
Workspace ตัวอย่างที่อยู่บน Controller อย่างเดียว ไม่ต่อ Hub ใช้ event ตัวอย่างที่ฝังมากับแอป ให้ลองทุกฟีเจอร์ได้โดยไม่ต้องมี Machine คำสั่งที่กดในนี้ไม่ถูกส่งไปที่ไหน
_Avoid_: Demo account, sandbox mode, guest mode

**Pairing**:
การผูก Machine ใหม่เข้ากับ Workspace ด้วยรหัสใช้ครั้งเดียว ถ้า Owner ของ Workspace เดิมเซ็นปล่อย Machine ไว้ก่อน Pairing ครั้งใหม่จะพา Agent, Workdir, Project และประวัติ Task ไปด้วย แต่ Grant ทั้งหมดถูกล้าง และ Schedule กับ Channel หยุด ถ้าไม่ได้ปล่อยไว้ Machine จะเริ่มใหม่จากศูนย์
_Avoid_: Registration, enroll

**Linking**:
การเพิ่ม Controller เครื่องใหม่ของ Member คนเดิม โดยให้ Controller ที่ได้รับความไว้ใจอยู่แล้วสแกน QR บนเครื่องใหม่ เครื่องใหม่จะสั่งงานได้ก็ต่อเมื่อผ่าน Linking หรือ Invitation เท่านั้น
_Avoid_: Login, sign-in, device registration

**Invitation**:
การเพิ่ม Member ใหม่เข้า Workspace จากที่ไกล Owner ส่งลิงก์ที่ใช้ได้ครั้งเดียวไปให้ แล้วทั้งสองฝั่งเทียบรหัสสั้นที่คำนวณจากกุญแจของคนที่ถูกเชิญ ก่อนที่ Owner จะเซ็นรับรอง รหัสที่ไม่ตรงกันแปลว่ามีคนสลับกุญแจระหว่างทาง
_Avoid_: Signup, registration, join link

**Revocation**:
การถอนกุญแจของ Controller เครื่องหนึ่ง ทำได้โดยเจ้าของจากเครื่องอื่นของตัวเอง หรือโดย Owner และการลบ Member คือการถอนกุญแจทุกเครื่องของคนนั้น Hub ตัดสายของกุญแจนั้นทันที และ Runtime จดไว้เองตอนต่อเข้ามาครั้งถัดไป ของที่เซ็นด้วยกุญแจนั้นแล้วทำงานเอง ได้แก่ Schedule และ Channel หยุดตามไปด้วย
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

**Connector**:
บริการภายนอกที่ต่อเข้ากับ Agent ผ่าน MCP ถ้าเป็นบริการบนเน็ต supervisor เป็นคนต่อและถือ credential ไว้เอง Agent เห็นแค่ tool และอ่าน credential ไม่ได้ ถ้าเป็นโปรแกรมบนเครื่อง จะรันใน sandbox ของ Agent และไม่ถือความลับ Connector หนึ่งตัวใช้บัญชีเดียว ซึ่งคนที่มี Manage เป็นคนผูก ใครที่มี Use ที่ Agent ก็ใช้บัญชีนั้นผ่าน Agent ได้ tool ของ Connector ถูกตรึงไว้ตั้งแต่ตอนติดตั้ง ถ้า server เปลี่ยนหรือเพิ่ม tool ต้องอนุมัติใหม่
_Avoid_: Integration, plugin, MCP server

**Memory**:
ไฟล์ `MEMORY.md` ใน Workdir ที่ Agent จดสิ่งที่ทุก Task ต้องรู้ Runtime ใส่เข้า prompt ตอนเริ่ม Task และตรึงไว้ทั้ง Task มีเพดานขนาด และ Agent แก้เองได้ เรื่องที่ไม่ต้องรู้ทุกครั้ง Agent ค้นเอาจาก Task เก่าของตัวเอง ส่วนความรู้ที่ใช้ร่วมกันหลาย Agent อยู่ใน Library
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
คำขอที่ Agent ส่งไปให้ Member ที่มี Grant ระดับ Approve อนุมัติก่อนทำสิ่งที่ไม่อยู่ใน Allowlist ระหว่างนั้น Task จะหยุดรอจนกว่าจะได้คำตอบ หรือจนกว่า Approval จะหมดอายุตามเวลาที่ตั้งไว้ใน Agent (ค่าเริ่มต้น 1 ชั่วโมง) ซึ่งจะนับว่าถูกปฏิเสธ Member ที่มี Manage เลือกอนุญาตตลอดได้ ซึ่งจะเพิ่มคำนำหน้าของคำสั่งนั้นเข้า Allowlist ไปพร้อมกัน
_Avoid_: Confirmation, consent, prompt

**Budget**:
จำนวน token ต่อวันที่ Agent ตัวหนึ่งใช้ได้ คนที่มี Manage เป็นคนตั้ง และ Runtime เป็นคนบังคับ ถ้าหมด Turn ที่ทำอยู่จะจบเหมือนโดน Stop และงานใหม่ไม่เริ่มจนกว่าจะขึ้นวันใหม่หรือมีคนเพิ่ม Budget
_Avoid_: Quota, limit, credit

**Task**:
บทสนทนาหนึ่งเรื่องระหว่าง Member กับ Agent ตัวหนึ่ง หรือกับ Project หนึ่ง คุยต่อได้หลายข้อความ Agent ที่ได้รับเป็นเจ้าของ Task นั้น ส่วน Task ของ Project เป็นของ Entry และในแอปอาจเรียก Task ของ Project ว่าห้อง ถ้า Task ยาวจนใกล้เพดาน context Runtime ย่อสิ่งที่ส่งให้ LLM เป็นบทสรุปก้อนเดียว แต่ประวัติใน Task ยังอยู่ครบ
_Avoid_: Chat, thread, session, job, run, room

**Turn**:
ช่วงที่ Agent ลงมือทำงานเพื่อตอบข้อความหนึ่งข้อความใน Task ทำในนามของคนที่ส่งข้อความนั้น ซึ่งไม่จำเป็นต้องเป็นคนที่เริ่ม Task เพราะ Member หลายคนพิมพ์ใน Task เดียวกันได้ เริ่มเมื่อได้รับข้อความ และจบเมื่อ Agent ตอบเสร็จหรือถูก Stop ระหว่าง Turn รวมถึงตอนรอ Approval Agent จะไม่ว่าง ส่วน Task ที่เปิดค้างไว้ไม่ได้ถือ Agent ถ้า worker หรือ Runtime เริ่มใหม่กลาง Turn Turn นั้นจบเหมือนโดน Stop และไม่ทำต่อเอง
_Avoid_: Run, step, iteration

**Schedule**:
ข้อความที่ Member ตั้งเวลาไว้และเซ็น ให้ Runtime เปิดเป็น Task ใหม่กับ Agent หรือ Project ทุกรอบ เป็นทางเดียวที่งานจะเริ่มได้โดยไม่มีคนพิมพ์ ทำในนามของ Member ที่ตั้ง ตอนตั้งเลือกได้ว่าเรื่องที่ Agent บอกจะแจ้งแค่คนตั้ง หรือทุกคนที่มี Use ที่ Agent นั้น และถ้าไม่มีอะไรต้องบอก Agent จบ Turn แบบไม่แจ้งใคร Task ของรอบนั้นก็ไม่ขึ้นใน Inbox Schedule หยุดทันทีเมื่อกุญแจของ Controller ที่เซ็นมันถูกถอน ซึ่งรวมถึงตอนที่ Member คนนั้นถูกลบ
_Avoid_: Heartbeat, cron, automation, routine, trigger

**Channel**:
แชตภายนอก เช่น กลุ่ม Telegram ที่ Member ผูกเข้ากับ Agent ตัวหนึ่งและเซ็นไว้ ใครในแชตนั้นก็คุยกับ Agent ได้ และงานที่เกิดขึ้นทำในนามของ Member ที่ผูก คนในแชตไม่ได้เป็น Member มีอำนาจเท่ากันหมด และตอบ Approval ไม่ได้ Agent ที่มี Channel อยู่ใน Project ไม่ได้ และอ่านไฟล์ได้แค่ใน Workdir ของตัวเองกับ Library ที่ได้สิทธิ์ Channel หยุดทันทีเมื่อกุญแจของ Controller ที่เซ็นมันถูกถอน แบบเดียวกับ Schedule
_Avoid_: Integration, connector, gateway, bot

**Stop**:
การสั่งให้ Turn ที่กำลังทำอยู่จบทันที พร้อมกับ Turn ของ Task ย่อยทั้งหมดที่อยู่ใต้ Task นั้น ไฟล์ที่แก้ไปแล้วคงสภาพเดิม และ Task ยังคุยต่อได้ Member ที่มี Use กับ Agent ตัวไหน กด Stop ได้ทุก Turn ของ Agent ตัวนั้น ไม่ว่าใครเป็นคนสั่ง ส่วนใน Project คนที่มี Use ของ Project กด Stop ได้
_Avoid_: Cancel, abort, kill, close

### Project

**Project**:
งานหนึ่งเรื่องที่มี Agent หลายตัวเป็นพนักงาน อยู่บน Machine เดียวกัน และมี Entry ตัวเดียว Member สั่งงานด้วยการเริ่ม Task กับ Project ซึ่งเป็นทางเดียวที่ Delegation จะเกิดได้ Agent ตัวหนึ่งเป็นพนักงานได้หลาย Project ยกเว้น Agent ที่มี Channel การเอา Agent เข้ามาเป็นพนักงานต้องมี Manage ที่ Agent ตัวนั้น ซึ่งเท่ากับยินยอมให้ Agent รับงานจากคนที่มีสิทธิ์ใน Project Project มี Library ของตัวเองเป็น wiki พนักงานทุกตัวอ่านได้ และมีพนักงานที่เขียนได้ตัวเดียว ค่าเริ่มต้นคือ Entry Project มี repo ได้หลายอัน ซึ่งพนักงานเขียนได้ระหว่างทำ Task ของ Project ถ้าเป็นงานที่ไม่ใช่โค้ด Runtime สร้าง repo ไฟล์งานให้เองบนเครื่อง ตอนสร้าง Project เลือกแม่แบบได้ เช่น โค้ด เอกสาร ดีไซน์ หรืองานผ่านระบบอื่น ซึ่งเป็นแค่ค่าตั้งต้นที่แก้ทีหลังได้ Member ที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัวสร้าง Project ได้ และได้ Manage ของ Project นั้น
_Avoid_: Team, swarm, crew, squad, group

**Worktree**:
สำเนาของทุก repo ของ Project ที่ Task หนึ่งได้ไปเมื่อติ๊กไว้ตอนเปิด Task อยู่ใน branch ชื่อเดียวกัน worktree หนึ่งมีคนเขียนได้ทีละหนึ่ง Turn Agent รัน Turn ที่อยู่คนละ worktree พร้อมกันได้ และระหว่างนั้น Workdir ของ Agent อ่านได้อย่างเดียว Task ที่ไม่ติ๊กใช้ checkout หลักร่วมกัน ทีละหนึ่ง Turn ส่วน Project ที่ไม่มี repo ให้ Task ได้โฟลเดอร์ว่างของตัวเองแทน ซึ่งใช้กฎเดียวกัน แต่ไม่ต้องรวมงานกลับ
_Avoid_: Branch, copy, sandbox

**Entry**:
พนักงานของ Project ที่รับข้อความของ Member ใน Task ของ Project และส่งงานต่อให้พนักงานตัวอื่นได้ทุกตัว Project หนึ่งมี Entry ตัวเดียว
_Avoid_: Lead, leader, manager, orchestrator

**Delegation**:
การที่ Entry ใน Task ของ Project สร้าง Task ย่อยส่งให้พนักงานตัวอื่น หรือส่งข้อความต่อใน Task ย่อยเดิม เช่น ตีงานกลับให้แก้ ส่งได้ชั้นเดียว พนักงานส่งต่ออีกไม่ได้ และใน Turn หนึ่งส่งได้ไม่เกินเพดานของ Project ส่วนจะส่งให้ใครเมื่อไหร่ Entry ตัดสินใจเองจากคำอธิบายของพนักงาน ทำในนามของ Member ที่ส่งข้อความของ Turn ต้นทางเสมอ พนักงานสั่งงานกันเองไม่ได้ แต่ถามกันได้ด้วย Ask
_Avoid_: Handoff, dispatch, Flow

**Ask**:
คำถามใน Project ที่ตอบด้วย Turn แบบอ่านอย่างเดียว คนถามคือ Member ที่มีสิทธิ์ Ask ขึ้นไปใน Project หรือพนักงานด้วยกัน คนตอบคือ Entry หรือพนักงานที่ถูก Mention Turn แบบนี้มีแค่ tool อ่านไฟล์ ค้น Task ของ Project และอ่าน wiki ไม่มี bash ไม่ส่งงานต่อ และไม่เรียก Connector จึงไม่ต้องรอคิว path ที่ Project ห้ามและ Task ที่ปิดจาก Ask อ่านไม่ได้ ส่วนหัวข้อที่ห้ามตอบเป็นแค่คำขอที่ LLM อาจไม่ทำตาม
_Avoid_: Query, read-only mode

**Mention**:
การแท็กด้วย @ ใน Task ของ Project Mention คนจะส่ง push ให้คนนั้น และทั้ง Member และ Agent Mention คนที่มีสิทธิ์ใน Project ได้ Mention พนักงานในข้อความสั่งงานเป็นการบอก Entry ว่าอยากให้ตัวนั้นทำ ส่วนใน Ask เป็นการถามพนักงานตัวนั้นตรงๆ
_Avoid_: Tag, ping

**Subagent**:
ตัวช่วยชั่วคราวที่ Agent สร้างขึ้นเองระหว่างทำ Task อยู่บน Machine เดียวกับ Agent แม่ มีแค่ tool read, glob และ grep จึงอ่านได้อย่างเดียว ส่ง Delegation ไม่ได้ ไม่มี Character และหายไปทันทีที่ส่งคำตอบกลับ ไม่ได้สร้าง Task ใหม่
_Avoid_: Helper, child agent, worker

### LLM

**Provider**:
ปลายทาง LLM ที่ Runtime เรียกใช้ กำหนดด้วย URL กับ key ของลูกค้า เช่น Anthropic, OpenRouter หรือ OpenCode Zen Owner ตั้ง Provider ไว้ที่ Machine และเครื่องหนึ่งมีได้หลายตัว supervisor ถือ key และเป็นทางผ่านของทุกคำขอไป LLM Agent จึงไม่เห็น key Agent แต่ละตัวใช้ Provider ตัวเดียวกับ model เดียวจากเครื่องนั้น ซึ่งคนที่มี Manage เป็นคนเลือก ถ้าเปลี่ยน จะมีผลตั้งแต่ Task ถัดไป
_Avoid_: Vendor, backend, model
