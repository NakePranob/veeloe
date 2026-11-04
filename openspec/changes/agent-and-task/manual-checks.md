# สิ่งที่ต้องลองด้วยมือ

agent ลองแล้วบน iOS Simulator และ Chromium กับ Hub บน Postgres, `veeloe` ตัวจริง และ Provider ปลอม ทั้งการสร้าง Agent, คุยหลายข้อความ, `agent.busy`, Provider ตอบ error, ปิดแอประหว่าง Turn แล้วเปิดใหม่, หน้า Agent และ Task ใหม่ ทั้งสองภาษา สว่างและมืด ไฟล์นี้จดสิ่งที่ต้องใช้ Provider จริงหรือเครื่องจริง

repo นี้เป็น public เมื่อรายงานผล ให้ระบุแค่เครื่อง รุ่น OS ข้อที่ลอง และผลที่ได้ และอย่าใส่ key ของ Provider ลิงก์ Pairing หรือเนื้อหาแชตที่เป็นความลับ

## เตรียม

ทำ Pairing ตาม `openspec/changes/machine-pairing/manual-checks.md` ก่อน แล้วรันในโฟลเดอร์เดียวกัน (`VEELOE_HOME` เดิม) คำสั่งจะถาม key โดยไม่แสดงบนจอ

```bash
VEELOE_HOME=/tmp/veeloe-try bun packages/runtime/src/main.ts provider add --name anthropic --url https://api.anthropic.com
```

```bash
VEELOE_HOME=/tmp/veeloe-try bun packages/runtime/src/main.ts
```

## 1. Provider จริง

| ข้อ | ทำอะไร | ควรเห็น |
|---|---|---|
| 1.1 | `provider add` ด้วย key ที่ถูก | terminal บอก saved พร้อมจำนวน model |
| 1.2 | `provider add` ด้วย key ผิด | not saved และไม่มีไฟล์ใหม่ใน `runtime/` |
| 1.3 | เพิ่ม OpenRouter ด้วย `--url https://openrouter.ai/api` | saved เพราะ Runtime ลองส่ง key แบบ Bearer ให้เอง |
| 1.4 | ในแอปกด + ที่การ์ด Machine | เห็น Provider ที่เพิ่มกับรายชื่อ model และค้นหา model ได้เมื่อมีหลายตัว |
| 1.5 | สร้าง Agent แล้วคุยภาษาไทย 2 ข้อความ | คำตอบข้อที่สองต่อจากบทสนทนาเดิม |
| 1.6 | เลือก model ที่มี thinking แล้วคุยต่อหลายข้อความ | ไม่มี error 400 จาก Provider และไม่เห็นข้อความ thinking ในแอป |
| 1.7 | `provider remove anthropic` แล้วส่งข้อความ | แอปบอกว่า Provider ของ Agent ถูกลบ ให้เพิ่มใหม่ |

## 2. iPhone จริง

| ข้อ | ทำอะไร | ควรเห็น |
|---|---|---|
| 2.1 | หน้าสร้าง Agent: พิมพ์ชื่อ แล้วกดสร้างทั้งที่คีย์บอร์ดยังเปิด | สร้างได้ในการกดครั้งเดียว บน Simulator ครั้งแรกเคยไม่ติด ยังไม่รู้ว่าเป็นที่ Simulator หรือไม่ |
| 2.2 | หน้า Task: แตะช่องพิมพ์ | ช่องพิมพ์อยู่ชิดเหนือคีย์บอร์ด และข้อความล่าสุดไม่ถูกบัง |
| 2.3 | คุยจนข้อความยาวเกินจอ | หน้าเลื่อนไปข้อความล่าสุดเอง |
| 2.4 | ปิด `veeloe` แล้วกลับมาเปิด | การ์ดบอกออฟไลน์ แล้วกลับมาออนไลน์เองภายในราว 30 วินาที โดยไม่ต้องเปิดแอปใหม่ |
| 2.5 | ทิ้งแอปจนล็อกแล้วปลดล็อกด้วย Face ID | แอปต่อ Hub ใหม่ และคำตอบที่มาระหว่างล็อกขึ้นครบ |

## 3. Machine

| ข้อ | ทำอะไร | ควรเห็น |
|---|---|---|
| 3.1 | `ps` ดูโปรเซส | `veeloe worker --agent <id>` หนึ่งตัวต่อ Agent และ `env` ของ worker ไม่มี key ของ Provider |
| 3.2 | `kill -9` worker ตัวหนึ่ง แล้วส่งข้อความหา Agent ตัวนั้น | ส่งได้อีกครั้งภายในไม่กี่วินาที และ Agent ตัวอื่นไม่สะดุด |
| 3.3 | Ctrl-C ที่ `veeloe` | worker ทุกตัวจบตาม ไม่เหลือค้าง |
