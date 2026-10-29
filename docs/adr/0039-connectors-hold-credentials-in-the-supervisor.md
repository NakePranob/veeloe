# Connector ต่อ MCP ผ่าน supervisor ซึ่งถือ credential ไว้เอง และตรึง tool ไว้ตั้งแต่ตอนติดตั้ง

Connector คือบริการภายนอกที่ต่อเข้ากับ Agent ผ่าน MCP ปัญหาหลักคือ credential ถ้าเก็บ token ไว้ใน Workdir หรือใน env ที่ Agent อ่านได้ หน้าเว็บที่หลอก Agent ได้ก็ขโมย token ได้ และคนในแชตของ Channel ก็ขอให้ส่ง token เข้ากลุ่มได้ เราจึงแยกตามชนิด MCP แบบ URL ให้ supervisor เป็นคนต่อและถือ credential ไว้เอง Agent เห็นแค่รายชื่อ tool และเรียกผ่าน supervisor ทาง IPC แบบเดียวกับ token ของ bot ใน Channel (ADR 0028) โดเมนของ MCP server จึงไม่ต้องอยู่ใน Egress ของ Agent และ Agent ไม่มีทางอื่นไปถึง server ได้เลย Allowlist ของ tool จาก Connector จึงเป็นกำแพงจริงที่ supervisor บังคับ ต่างจาก Allowlist ของ bash ที่เลี่ยงได้ (ADR 0030) ส่วน MCP แบบคำสั่งรันใน sandbox ของ Agent เหมือนโปรแกรมทั่วไป ทำได้ไม่เกินที่ Agent ทำได้ และไม่ควรถือความลับ เพราะโปรเซสใน sandbox เดียวกันอ่าน env ของกันได้ บริการที่ต้องใช้ token ให้ใช้แบบ URL

Connector หนึ่งตัวใช้บัญชีเดียว ซึ่ง Member ที่มี Manage เป็นคนผูก แอปบอกชัดว่าใช้บัญชีไหน และใครที่มี Use ที่ Agent ก็ใช้บัญชีนั้นผ่าน Agent ได้ ตรงกับกฎเดียวกับ Egress และ Library ที่ให้ Agent เข้าถึงอะไร ก็เท่ากับให้ทุกคนที่ใช้ Agent นั้นเข้าถึงได้ด้วย จึงควรใช้บัญชี bot หรือ service account ไม่ใช่บัญชีส่วนตัว การ login ด้วย OAuth ให้แอปเป็นคนทำผ่านเบราว์เซอร์ของระบบด้วย PKCE แลก code เป็น token เอง แล้วเข้ารหัสด้วยกุญแจของ Machine แบบ sealed box เหมือน key ของ Provider (ADR 0005) Hub จึงส่งต่อได้แต่อ่านไม่ได้ และห้ามเป็นที่รับ redirect หลังส่งแล้วแอปลบสำเนาของตัวเอง ให้ supervisor เป็นคนเดียวที่ refresh เพราะบางผู้ให้บริการออก refresh token ใหม่ทุกครั้งที่ใช้ บริการที่มือถือต่อไม่ถึง เช่น อยู่ในเครือข่ายภายใน ให้ใส่ API key หรือ token เองแล้วเข้ารหัสแบบเดียวกัน

MCP server เป็นคนบอกว่ามี tool อะไรและแต่ละตัวทำอะไร คำอธิบายเหล่านี้เข้า prompt ตรงๆ จึงฝังคำสั่งได้ (tool poisoning) และเปลี่ยนทีหลังได้ (rug pull) ตอนติดตั้ง แอปจึงแสดงชื่อ คำอธิบาย และ schema ของทุก tool แล้ว Member เซ็นทับ hash ของสิ่งที่เห็น supervisor ส่งให้ Agent เฉพาะ tool ที่ตรงกับที่ตรึงไว้ ถ้า server เปลี่ยนหรือเพิ่ม tool ต้องอนุมัติใหม่ ทุก tool ต้องขอ Approval จนกว่าจะอยู่ใน Allowlist ด้วยชื่อเต็ม เช่น `github/create_pull_request` ตอนติดตั้งแอปติ๊ก tool ที่ server บอกว่าอ่านอย่างเดียว (`readOnlyHint`) ไว้ให้ แต่ Member ต้องอ่านเอง เพราะ hint มาจาก server ผลที่ได้จาก tool ถือเป็นข้อมูลที่ไม่น่าไว้ใจเหมือนหน้าเว็บ

## Considered Options

- **รัน MCP ทุกแบบใน sandbox ของ Agent และเก็บ token ไว้ใน Workdir**: ง่ายที่สุดและทำงานเหมือน Claude Code บนเครื่องส่วนตัว แต่ token อยู่ในมือ Agent Allowlist ของ tool เลี่ยงได้ด้วยการเรียก API ผ่าน `curl` และ Agent ที่มี Channel ใช้ Connector ที่มี token ไม่ได้อย่างปลอดภัย
- **Member แต่ละคนผูกบัญชีของตัวเอง แล้ว Agent ใช้บัญชีของคนที่สั่งงาน**: ระบบภายนอกเห็นว่าใครทำอะไร และตรงกับ ADR 0010 แต่ทุกคนต้องผูกเอง Agent ต้องเก็บ token หลายชุด และ Schedule กับ Channel ต้องใช้ token ของคนที่เซ็น เพิ่มทีหลังได้แบบ additive
- **ให้ Hub รับ redirect ของ OAuth**: ไม่ต้องให้แอปแลก token เอง แต่ Hub จะเห็นรหัสและ token ซึ่งขัดกับ ADR 0005
- **ไม่ตรึง tool**: server อัปเดต tool ได้โดยไม่ต้องอนุมัติซ้ำ แต่ใครที่คุม server ได้ก็ใส่คำสั่งเข้า prompt ของ Agent ได้ทุกเมื่อ

## Consequences

- MCP server บางเจ้า เช่น GitHub หรือ Google ไม่รับการลงทะเบียนอัตโนมัติ ต้องลงทะเบียนแอป Veeloe ไว้ล่วงหน้าทีละเจ้า
- scope ของ OAuth มักกว้างเกินไป เช่น `repo` ของ GitHub ซึ่งเราแก้ไม่ได้ Allowlist ของ tool ช่วยจำกัดได้ว่า Agent เรียกอะไรได้บ้าง
- ถ้า refresh ไม่ได้ แอปต้องแจ้งให้ login ใหม่ ไม่ปล่อยให้ Agent เจอ error เงียบๆ
- Connector ที่ดึง URL ใดก็ได้ เช่น Firecrawl เปิดเว็บจากเซิร์ฟเวอร์ของตัวเอง จึงเป็นช่องที่ข้าม Egress ได้ tool แบบนี้ควรขอ Approval ทุกครั้ง และแอปต้องเตือนตอนติดตั้ง (ADR 0040)
- credential ของ Connector เก็บไว้ในโฟลเดอร์ของ supervisor ซึ่ง sandbox ห้าม Agent แตะ (ADR 0032) และถูกล้างเมื่อย้าย Machine ไป Workspace อื่น (ADR 0035)
- Connector หยุดทันทีเมื่อกุญแจที่เซ็นมันถูกถอน แบบเดียวกับ Schedule และ Channel (ADR 0031) ถ้าแค่ทำมือถือหาย credential ยังอยู่ เซ็นใหม่จากเครื่องอื่นแล้วใช้ต่อได้ ระหว่างที่หยุด tool ของ Connector ตอบ Agent ว่าหยุดอยู่
- ถ้าลบ Member แอปแสดง Connector ที่คนนั้นผูกไว้พร้อมชื่อบัญชี Owner เลือกได้ทีละตัวว่าจะเซ็นใหม่เป็นชื่อตัวเอง ผูกใหม่ด้วยบัญชีอื่น หรือปล่อยให้หยุด ตัวที่ไม่ได้เซ็นใหม่ supervisor ลบ credential ทิ้ง แต่ไม่ได้ยกเลิก token ที่ฝั่งผู้ให้บริการ เพราะแต่ละเจ้ายกเลิกไม่เหมือนกัน แอปบอกให้เจ้าของบัญชีไปยกเลิกเอง
