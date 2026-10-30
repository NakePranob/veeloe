# Controller prototype (ทิ้งได้)

นี่คือ **prototype** ของ Controller ไม่ใช่ตัวจริง ทำงานบนข้อมูลของ Demo Workspace ที่อยู่ในหน่วยความจำ ไม่ต่อ Hub ไม่มีกุญแจ และไม่เซ็นอะไร

**คำถามที่ตอบ:** Controller ควรมีหน้าตาและการใช้งานแบบไหน

**คำตอบที่ได้ และให้ Controller ตัวจริงเอาไปใช้**
- หน้าตาขาวดำโทนฟ้าอ่อนแบบเดียวกันทุก platform มีปุ่มทรง pill กับการ์ดสีขาวที่มีเงา และใช้ navigation, alert กับเมนูของ platform เอง (design system: https://claude.ai/artifact/FLFrmUHanU1rdq7qF6bR8R)
- Inbox, หน้าแชตของ Task, การ์ด Approval และเมนู Effort
- Character เป็นหัวหุ่นยนต์ลอยแบบ 2.5D ที่แสดง Mood และแก้ได้จาก sheet บนหน้า Task (spec: `openspec/specs/controller-character`)
- กด Agent ใน Inbox แล้วเข้าแชตเลย ไม่มีหน้าเลือกคั่น

Controller ตัวจริงจะเริ่มใหม่ที่ `controller/` ตาม phase ใน ADR 0048 ถ้าจะเอาโค้ดส่วนไหนจากที่นี่ไปใช้ ให้ย้ายไปเองทีละส่วน อย่า import ข้ามโฟลเดอร์ เมื่อตัวจริงมีหน้าเหล่านี้ครบแล้ว ให้ลบโฟลเดอร์นี้ทิ้ง ประวัติยังอยู่ใน git

## รัน

```bash
bun run prototype
```

เปิดบนเว็บที่ http://localhost:8081 ถ้าจะเปิดบน iOS หรือ Android ให้ `cd controller-prototype && bunx expo start`
