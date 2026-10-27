# Veeloe

ระบบ Agent ที่ติดตั้งลงหลายเครื่อง Agent บนเครื่องเดียวกันทำงานร่วมกันเป็นทีมได้ และสั่งการได้จากทุกที่ผ่านแอปมือถือ

## Language

### ที่อยู่และความไว้ใจ

**Workspace**:
ขอบเขตความเป็นเจ้าของ Machine และ Agent ทุกตัวเป็นของ Workspace เดียว และมองไม่เห็นของ Workspace อื่น
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
Member ที่ทำ Pairing ได้ เพิ่มหรือลบ Member ได้ และแจก Grant ได้ มีสิทธิ์ Manage กับ Agent ทุกตัว และกุญแจของ Owner คือจุดเริ่มต้นของความไว้ใจทั้ง Workspace
_Avoid_: Admin, root

**Grant**:
สิทธิ์ที่ Member มีต่อ Agent ตัวหนึ่ง มีสามระดับคือ Use (สั่งและดู Task), Approve (ตอบ Approval) และ Manage (แก้ค่า Agent, Allowlist, เส้นใน Flow ที่ชี้เข้าหา Agent ตัวนี้ และตั้ง Agent ตัวนี้เป็น Entry ของ Team) ระดับที่สูงกว่าได้สิทธิ์ของระดับที่ต่ำกว่าด้วย
_Avoid_: Role, permission, ACL

**Controller**:
แอปที่ Member คนหนึ่งติดตั้งบนมือถือหรือเบราว์เซอร์และได้รับความไว้ใจจาก Workspace คำสั่งทุกอย่างต้องมาจาก Controller และถือว่าเป็นคำสั่งของ Member เจ้าของ Controller นั้น
_Avoid_: Device, client, phone, app

**Demo Workspace**:
Workspace ตัวอย่างที่อยู่บน Controller อย่างเดียว ไม่ต่อ Hub ใช้ event ตัวอย่างที่ฝังมากับแอป ให้ลองทุกฟีเจอร์ได้โดยไม่ต้องมี Machine คำสั่งที่กดในนี้ไม่ถูกส่งไปที่ไหน
_Avoid_: Demo account, sandbox mode, guest mode

**Pairing**:
การผูก Machine ใหม่เข้ากับ Workspace ด้วยรหัสใช้ครั้งเดียว
_Avoid_: Registration, enroll

**Linking**:
การเพิ่ม Controller ใหม่เข้า Workspace โดยให้ Controller ที่ได้รับความไว้ใจอยู่แล้วสแกน QR บนเครื่องใหม่ เป็นทางเดียวที่เครื่องใหม่จะสั่งงานได้
_Avoid_: Login, sign-in, device registration

**Hub**:
บริการกลางที่เรา host ส่งต่อข้อความระหว่าง Controller กับ Runtime ไม่รัน Agent และไม่ถือ key ของ LLM
_Avoid_: Server, gateway, relay, broker

**Protocol**:
ภาษากลางที่ Controller, Runtime และ Hub ใช้คุยกัน กำหนดว่าซอง ข้อความ และ event หน้าตาเป็นยังไง และต้องเซ็นยังไง เปิดให้คนอื่นใช้สร้าง Hub หรือ Controller ของตัวเองได้
_Avoid_: API, SDK, contract

### Agent และงาน

**Agent**:
ตัวทำงานที่ใช้ LLM ตัดสินใจแล้วลงมือทำผ่าน tool อยู่บน Machine เดียวตลอดและแตะได้แค่สิ่งที่เครื่องนั้นมี ทำได้ทีละ Turn Machine หนึ่งมีได้หลาย Agent
_Avoid_: Bot, worker

**Character**:
ตัวละครประจำตัวของ Agent ตัวหนึ่ง ใช้แสดงอารมณ์ผ่านท่าทางบน Controller เป็นแค่หน้าตา ไม่มีผลกับคำพูดหรือการทำงานของ Agent
_Avoid_: Avatar, persona, mascot

**Mood**:
ท่าทางที่ Character กำลังแสดงอยู่ ได้มาจากสถานะของ Agent และเหตุการณ์ใน Task เช่น ยกมือตอนรอ Approval หรือดีใจตอน Task เสร็จ LLM ไม่ได้เป็นคนเลือก
_Avoid_: Emotion, expression, animation

**Workdir**:
โฟลเดอร์บน Machine ที่ Agent ตัวหนึ่งเขียนไฟล์ได้ นอกโฟลเดอร์นี้เขียนไม่ได้ Agent ที่อยู่ Team เดียวกันอ่าน Workdir ของกันได้แต่เขียนไม่ได้
_Avoid_: Workspace, project, sandbox

**Egress**:
รายชื่อโดเมนที่ Agent บน Machine หนึ่งออกไปได้ ตั้งต่อ Machine และ Agent ทุกตัวบนเครื่องนั้นใช้ร่วมกัน เป็นคนละเรื่องกับ Allowlist
_Avoid_: Network allowlist, whitelist, firewall rules

**Allowlist**:
รายการสิ่งที่ Agent ตัวหนึ่งทำได้ทันทีโดยไม่ต้องขอ Approval
_Avoid_: Permissions, whitelist, rules

**Approval**:
คำขอที่ Agent ส่งไปให้ Member ที่มี Grant ระดับ Approve อนุมัติก่อนทำสิ่งที่ไม่อยู่ใน Allowlist ระหว่างนั้น Task จะหยุดรอจนกว่าจะได้คำตอบ หรือจนกว่า Approval จะหมดอายุตามเวลาที่ตั้งไว้ใน Agent (ค่าเริ่มต้น 1 ชั่วโมง) ซึ่งจะนับว่าถูกปฏิเสธ
_Avoid_: Confirmation, consent, prompt

**Task**:
บทสนทนาหนึ่งเรื่องระหว่าง Member กับ Agent ตัวหนึ่ง หรือกับ Team หนึ่ง คุยต่อได้หลายข้อความ Agent ที่ได้รับเป็นเจ้าของ Task นั้น ส่วน Task ของ Team เป็นของ Entry
_Avoid_: Chat, thread, session, job, run

**Turn**:
ช่วงที่ Agent ลงมือทำงานเพื่อตอบข้อความหนึ่งข้อความใน Task เริ่มเมื่อได้รับข้อความ และจบเมื่อ Agent ตอบเสร็จหรือถูก Stop ระหว่าง Turn รวมถึงตอนรอ Approval Agent จะไม่ว่าง ส่วน Task ที่เปิดค้างไว้ไม่ได้ถือ Agent
_Avoid_: Run, step, iteration

**Schedule**:
ข้อความที่ Member ตั้งเวลาไว้และเซ็น ให้ Runtime เปิดเป็น Task ใหม่กับ Agent หรือ Team ทุกรอบ เป็นทางเดียวที่งานจะเริ่มได้โดยไม่มีคนพิมพ์ ทำในนามของ Member ที่ตั้ง และถ้าไม่มีอะไรต้องบอก Agent จบ Turn แบบไม่แจ้งใคร Task ของรอบนั้นก็ไม่ขึ้นใน Inbox
_Avoid_: Heartbeat, cron, automation, routine, trigger

**Stop**:
การสั่งให้ Turn ที่กำลังทำอยู่จบทันที พร้อมกับ Turn ของ Task ย่อยทั้งหมดที่อยู่ใต้ Task นั้น ไฟล์ที่แก้ไปแล้วคงสภาพเดิม และ Task ยังคุยต่อได้
_Avoid_: Cancel, abort, kill, close

### ทีม

**Team**:
กลุ่ม Agent ที่ตั้งชื่อไว้ อยู่บน Machine เดียวกัน มี Flow และ Entry ของตัวเอง Member สั่งงานทีมด้วยการเริ่ม Task กับ Team ซึ่งเป็นทางเดียวที่ Delegation จะเกิดได้ Agent ตัวหนึ่งอยู่ได้หลาย Team
_Avoid_: Swarm, crew, squad, group

**Entry**:
Agent ใน Team ที่รับข้อความของ Member ใน Task ของ Team นั้น Team หนึ่งมี Entry ตัวเดียว
_Avoid_: Lead, leader, manager, orchestrator

**Flow**:
ผังของ Team หนึ่งที่ Member วาดว่า Agent ตัวไหน Delegation ให้ตัวไหนได้ เส้นแต่ละเส้นบอกว่าใช้ส่งงานแบบไหนและส่งข้ามได้กี่ครั้งต่อ Turn ถ้าไม่มีเส้นก็ส่งไม่ได้ ส่วนจะส่งเมื่อไหร่ Agent เป็นคนตัดสินใจเอง
_Avoid_: Workflow, pipeline, graph

**Delegation**:
การที่ Agent ใน Task ของ Team สร้าง Task ย่อยส่งให้ Agent อีกตัวตามเส้นใน Flow หรือส่งข้อความต่อใน Task ย่อยเดิม เช่น ตีงานกลับให้แก้ ทำในนามของ Member ที่เริ่ม Task ต้นทางเสมอ
_Avoid_: Handoff, dispatch

**Subagent**:
ตัวช่วยชั่วคราวที่ Agent สร้างขึ้นเองระหว่างทำ Task อยู่บน Machine เดียวกับ Agent แม่ อ่านได้อย่างเดียว ส่ง Delegation ไม่ได้ ไม่มี Character และหายไปทันทีที่ส่งคำตอบกลับ ไม่ได้สร้าง Task ใหม่
_Avoid_: Helper, child agent, worker

### LLM

**Provider**:
ปลายทาง LLM ที่ Runtime เรียกใช้ กำหนดด้วย URL กับ key ของลูกค้า เช่น Anthropic, OpenRouter หรือ OpenCode Zen
_Avoid_: Vendor, backend, model
