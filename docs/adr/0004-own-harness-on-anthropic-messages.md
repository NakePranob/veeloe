# เขียน harness เองบนรูปแบบ Anthropic Messages โดย Provider เป็นแค่ URL กับ key

ลูปของ Agent (harness) เราเขียนเอง ไม่ใช้ Claude Agent SDK เพราะการเป็นเจ้าของ harness คือเป้าหมายของโปรเจกต์ และเราไม่อยากผูกพฤติกรรมของ Agent ไว้กับ harness ของ Claude Code ตัว harness คุยกับ LLM ผ่าน `@anthropic-ai/sdk` ทางการ ส่วน Provider ที่ลูกค้าเลือกเป็นแค่ base URL กับ key ของปลายทางที่รองรับรูปแบบ Anthropic Messages เช่น Anthropic โดยตรง, OpenRouter (`https://openrouter.ai/api`) หรือ OpenCode Zen แบบนี้รองรับได้หลายเจ้าโดยไม่ต้องเขียนโค้ดแยกให้แต่ละเจ้า

## Considered Options

- **Claude Agent SDK**: ได้ harness สำเร็จรูปพร้อม tool แต่ harness จะไม่ใช่ของเรา
- **Library หลาย provider (Vercel AI SDK, pi-ai)**: ฟีเจอร์เฉพาะของแต่ละเจ้า (prompt caching, thinking, compaction) มักหายไปในชั้นกลาง

## Consequences

- model ที่ไม่ใช่ Claude เรียกผ่าน gateway เหล่านี้ได้ แต่ไม่รับประกันว่าจะเรียก tool ได้ดี ถ้าต้องรองรับจริงจัง ค่อยเพิ่ม adapter แบบ OpenAI-compatible เป็นตัวที่สอง
- Bedrock และ Vertex ต้องใช้ client class ของแพลตฟอร์มนั้นใน Anthropic SDK แค่เปลี่ยน URL ไม่พอ
