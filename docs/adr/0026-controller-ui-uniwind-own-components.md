# UI ของ Controller เป็นขาวดำ เขียนด้วย Uniwind และ component ของเราเอง ส่วนหน้าตาอยู่ใน DESIGN.md

Controller เป็นที่ที่คนกด Approve หรือ Stop คำสั่งที่รันอยู่บนเครื่องจริง บางครั้งเป็นการ deploy ขึ้น production จากมือถือ หน้าจอจึงต้องนิ่งและชัด ไม่มีอะไรแย่งความสนใจตอนที่คนกำลังตัดสินใจ เราจึงให้ส่วนที่เป็นเครื่องมือเป็นขาวดำทั้งหมด สีหลักคือสีที่ตัดกับพื้นมากที่สุด ได้แก่ดำใน light mode และขาวใน dark mode สีมีแค่สองที่: Character ของแต่ละ Agent กับสีของสถานะ ส่วนแนวคิดหลักเอามาจาก Muse ของ Meta คือ Character อยู่บนสุดของ Task ไม่มีฟองแชท และมีสถานะสามชั้นที่มาจาก event log เดียวกัน (ADR 0018) รายละเอียดทั้งหมดของหน้าตา (token, ฟอนต์, component และกติกา) อยู่ใน `controller/DESIGN.md` ซึ่งเป็นแหล่งข้อมูลจริงเพียงแห่งเดียว

ส่วนเทคนิค:
- **Style:** เขียนด้วย Uniwind (Tailwind v4 บน React Native) token เป็น CSS variable ใน `global.css` ไฟล์เดียว ซึ่ง React Flow ใน DOM component ของผัง Flow ก็ใช้ชุดเดียวกัน
- **Component:** เขียนเองทั้งหมดใน `src/shared/ui` ถ้า OS มีให้อยู่แล้ว ให้ใช้ของ OS แทนการเขียนเอง ได้แก่ sheet และ modal ของ Expo Router และการเคลื่อนไหวด้วย Reanimated
- **State:** ไม่ใช้ library ข้อมูลอ่านจาก SQLite ด้วย live query (ADR 0021) ส่วน state ของหน้าจอใช้ React state กับ params ของ Expo Router
- **ฟอนต์:** ใช้ "Veeloe Sans" ซึ่งรวมตัวอังกฤษของ Geist กับตัวไทยของ Anuphan เป็นไฟล์เดียว เพราะ React Native รับ `fontFamily` ได้ตัวเดียว ถ้าไม่รวม ตัวไทยบนมือถือจะกลายเป็นฟอนต์ของระบบ
- **ภาษา:** มีทั้งอังกฤษและไทยตั้งแต่หน้าจอแรก

## Considered Options

- **NativeWind กับ react-native-reusables**: มี component แบบ shadcn ให้คัดลอกมาใช้ ประหยัดงานเรื่อง dialog และ menu แต่เราอยากคุมหน้าตาของทุกชิ้นให้เป็นแบบ Muse เอง และ Uniwind เร็วกว่าบน React Native
- **HeroUI Native**: สวยและสร้างบน Uniwind โดยตรง แต่รองรับแค่ iOS กับ Android บนเว็บจึงต้องมี component อีกชุด
- **Tamagui**: มีครบทั้ง component, theme และ compiler แต่ API เป็นของตัวเองและผูกแน่น
- **Zustand หรือ Jotai**: มีที่เก็บ state ของ UI กลาง แต่คนจะเอาข้อมูลจริงไปใส่ใน store ซ้ำกับ SQLite จนกลายเป็นสองแหล่งที่อาจไม่ตรงกัน
- **ปล่อยให้เครื่องเลือกฟอนต์ไทยเอง**: ไม่ต้องทำอะไร แต่ตัวไทยจะเป็น Sukhumvit บน iOS และ Noto บน Android หน้าตาไม่เหมือนกันและไม่ใช่ Anuphan

## Consequences

- **accessibility เป็นงานของเราทั้งหมด:** เพราะเขียน component เอง ทั้ง label สำหรับ screen reader, focus บนเว็บ, พื้นที่ให้แตะอย่างน้อย 44 และการขยายตัวอักษร กติกาเหล่านี้อยู่ใน DESIGN.md
- **ต้องมีสคริปต์รวมฟอนต์:** ใช้ fonttools ทำครั้งเดียวต่อการอัปเดตฟอนต์ต้นทาง ฟอนต์ที่รวมแล้วต้องใช้ OFL และตั้งชื่อใหม่
- **Character เลือกใช้ Rive** เพราะ state machine ของ Rive รับ Mood เป็น input ได้ตรงๆ แต่ยังต้องยืนยันพร้อมกับการออกแบบหน้าตาของ Character (#23)
- **ข้อความทุกชิ้นต้องผ่านตารางแปลตั้งแต่ตั๋วแรก (#8):** คำใน CONTEXT.md ใช้เหมือนกันทั้งสองภาษา ส่วนคำที่เป็นการกระทำแปลเป็นไทย
- **DESIGN.md กับ `global.css` ต้องแก้ไปพร้อมกันเสมอ:** ถ้าไม่แก้คู่กัน agent จะทำตาม token ที่ไม่ตรงกับของจริง
