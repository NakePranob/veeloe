# ค้นเว็บผ่าน tool ของ Provider หรือ Connector และมี web_fetch ตัวเล็กที่อยู่ใต้ Egress

งาน research ต้องค้นและเปิดเว็บที่บอกล่วงหน้าไม่ได้ว่าเป็นที่ไหน Provider บางเจ้ามี tool ค้นและเปิดเว็บที่รันบนเซิร์ฟเวอร์ของตัวเอง เช่น `web_search` กับ `web_fetch` ของ Anthropic ซึ่งไม่ต้องเปิด Egress และ `web_fetch` ของ Anthropic เปิดได้เฉพาะ URL ที่เคยปรากฏในบทสนทนา ถ้า Provider มี tool นี้ให้ใช้ของ Provider ถ้าไม่มี ให้ค้นผ่าน Connector (ADR 0039) เช่น MCP ของ Brave, Tavily, Exa หรือ Perplexity ด้วย key ของลูกค้าที่ supervisor ถือไว้ ส่วนการเปิดเว็บ Runtime มี `web_fetch` ตัวเล็กของตัวเองที่ดึงหน้าเว็บด้วย HTTP ธรรมดาแล้วแปลงเป็นข้อความอ่านง่าย และตัดให้ไม่เกินขนาดที่กำหนด แบบเดียวกับ `web_fetch` ของ OpenClaw tool นี้รันใน worker จึงเปิดได้เฉพาะโดเมนที่อยู่ใน Egress ของ Agent (ADR 0029) supervisor ห้ามเป็นคนเปิดเว็บแทน ไม่อย่างนั้น Agent จะเปิดเว็บไหนก็ได้โดยไม่ผ่าน Egress หน้าที่ต้องใช้ JavaScript หรือต้อง login ใช้ Firecrawl หรือ Browserbase ผ่าน Connector หรือใช้ Playwright MCP บนเครื่องที่รันใน sandbox ของ Agent

## Considered Options

- **ทำ `web_search` ในตัวแล้วให้เลือกผู้ให้บริการได้ แบบ OpenClaw และ Hermes**: ลูกค้าใส่แค่ API key ก็ใช้ได้ แต่เราต้องเขียนและดูแลตัวเชื่อมกับผู้ให้บริการทุกเจ้าเอง ทั้งที่ทุกเจ้ามี MCP อยู่แล้ว
- **ไม่ทำ `web_fetch` เอง ให้ใช้ `curl` ผ่าน bash**: ไม่มีโค้ดใหม่ แต่ได้ HTML ดิบที่เปลือง token และ `curl` อาจต้องขอ Approval ทุกครั้งตาม Allowlist

## Consequences

- Connector ที่ดึง URL ใดก็ได้ เช่น Firecrawl เป็นช่องที่ข้าม Egress Agent ที่โดนหลอกสั่งให้มันเปิด URL ที่แนบความลับไว้ได้ tool แบบนี้ต้องขอ Approval ทุกครั้ง ซึ่งบังคับได้จริงเพราะ supervisor เป็นคนคุม (ADR 0039) และแอปต้องเตือนตอนติดตั้ง ยิ่งถ้าเป็น Agent ที่มี Channel
- `web_fetch` ของเราไม่ได้มีกฎเปิดเฉพาะ URL ที่เคยปรากฏแบบของ Anthropic เพราะ Egress คุมอยู่แล้ว และถ้า Egress เปิดทั้งเน็ต Agent ก็ใช้ `curl` แทนได้อยู่ดี
