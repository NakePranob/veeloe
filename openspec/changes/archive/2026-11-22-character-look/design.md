## Context

ดู proposal.md (Why)

`look.ts` มี `COLORS` 8 สี pastel และ `lookOf()` ใช้ `COLORS[0]` (`#F4B183`) เป็นสีเริ่มต้น `pages/agent-character/ui/CharacterPage.tsx` มีแผนที่ hex เป็นชื่อสีของตัวเอง `mood.ts` คืน Mood หกแบบ โดย `turn.ended` ที่ `reason` ไม่ใช่ `done` คืนค่า `idle`

`Character.tsx` วาดหัวบนตาราง 100 หน่วย และ head ใหม่บน canvas (`Head.dc.html`) ทำตามวิธีวาดเดิมนี้ทุกอย่าง เพิ่มแค่เปลือก `round` ท่า `failed` และท่า `stuck`

## Goals / Non-Goals

**Goals:**

- Agent ที่มีอยู่หน้าตาไม่เปลี่ยนหลังอัปเดตแอป
- Mood มีนิยามเดียวใน `entities/character` ทั้ง Inbox หน้า Task และหน้า Agent ใช้ร่วมกัน

**Non-Goals:**

- การตัดสินว่า Turn ค้าง: อยู่ใน `live-tool-output`
- ย้ายหรือแก้หน้าอื่นนอกจากหน้าแก้ Character และหน้าสร้าง Agent

## Decisions

### 1. แยกสีเริ่มต้นออกจากชุดสีที่เลือกได้

`DEFAULT_COLOR = "#F4B183"` เป็นค่าคงที่ของตัวเอง และ `lookOf()` ใช้ค่านี้ ไม่ใช้ `COLORS[0]` ส่วน `COLORS` เปลี่ยนเป็นชุดใหม่ `#FFD84D #8CCBFF #7EE0B5 #C4B1FF #FFB3A1 #FFB066 #FFA8D2 #E3CFA8`

สีของ Agent เป็น hex ใดก็ได้ที่ Machine เก็บไว้ Agent ที่ใช้สีเดิมจึงวาดด้วยสีเดิมต่อไป แต่ในหน้าแก้ Character จะไม่มีวงไหนถูกเลือก จนกว่า Owner จะกดสีใหม่

- **ทางที่ไม่เลือก: จับคู่สีเก่ากับสีใหม่ที่ใกล้ที่สุดตอนวาด** ขัดกับ requirement "หน้าตา SHALL ไม่เปลี่ยนเมื่ออัปเดตแอป" และ Controller สองรุ่นจะวาด Agent ตัวเดียวกันคนละสี
- **ทางที่ไม่เลือก: ส่ง `agent.update` เปลี่ยนสีให้ทุก Agent** เปลี่ยนของที่ Owner เลือกไว้โดยไม่ได้ถาม

### 2. Mood เจ็ดแบบใน spec และแปดแบบในโค้ด

ลำดับการตัดสินใน `moodOf()`:

```
offline  (Machine ออฟไลน์)                  มาก่อนทุกแบบ
waiting  (event ล่าสุด approval.requested)
failed   (turn.ended reason error)          ใหม่
done     (turn.ended reason done)
idle     (ไม่มี event / stopped / interrupted)
working  (llm.message ที่ขอ tool)
thinking (อื่นๆ ระหว่าง Turn)
stuck    (ยังไม่มีอะไรคืนค่านี้ live-tool-output จะเพิ่ม)
```

`turn.ended` ที่ `reason` เป็น `stopped` หรือ `interrupted` คงเป็นว่าง เพราะเป็นการหยุดตามคำสั่งหรือ Machine เริ่มใหม่ ไม่ใช่ความล้มเหลวของ Agent สถานะ "Turn ถูกขัดจังหวะ" มีคำบอกในแถวอยู่แล้ว

type `Mood` มี `stuck` ตั้งแต่ change นี้ เพื่อให้ `Character` วาดท่าได้และทดสอบด้วยภาพได้ แต่ spec ยังไม่ประกาศ Mood นี้จนกว่า `live-tool-output` จะมีสิ่งที่ทำให้เกิด

### 3. ท่าใหม่ตามแผ่น Character

- **ล้มเหลว:** จอเป็นตาไขว้ (✕✕) สีแดงอ่อน หัวเอียงนิ่งและไม่ลอย ไม่มีการกระโดดฉลอง
- **ค้าง:** ตาเป็นเกลียวหรือจุดค้าง และสั่นเล็กน้อยเป็นจังหวะห่างๆ
- **ลดการเคลื่อนไหว:** ทั้งสองท่าหยุดนิ่งตามกฎเดิม

ทรงกลมใช้ path วงกลมรัศมี 34 บนตารางเดิม จอ `[24,37,52,28,14]` ด้านบนที่ 17 ช่องข้างที่ `[16,84]` และมือที่ `[82,24]` ตามที่ปรับบน canvas แล้ว

### 4. หน้าแก้ Character ใช้ชิ้นจาก `shared/ui`

- **ฉาก:** พื้นสีอ่อนคำนวณจากสีของ Agent ด้วย helper `tint()` ใน `entities/character` หน้านี้จึงไม่มี hex ของตัวเอง
- **ปุ่มสุ่ม:** `Button floating`
- **ช่องเลือก:** ช่อง tile อยู่ใน `entities/character` เพราะต้องวาด Character

## Risks / Trade-offs

- **[Agent เก่ามีสีที่ไม่อยู่ในชุดใหม่]** Inbox จะมีสีสองชุดปนกัน → ยอมรับได้ เพราะรักษาหน้าตาที่ Owner เลือกไว้ และ Owner กดเปลี่ยนเองได้ในหน้าแก้ Character
- **[ล้มเหลวกับค้างแยกกันไม่ออกถ้าท่าคล้ายกัน]** → ทั้งสองท่ามีคำสถานะอยู่ข้างๆ และต่างกันทั้งตาและสีจอ ต้องดูจากภาพบนเครื่องจริงก่อนปิด task
- **[Controller เก่าเห็นทรงกลมเป็นกล่อง]** → เป็นพฤติกรรมที่ spec กำหนดไว้แล้วสำหรับค่าที่ไม่รู้จัก
