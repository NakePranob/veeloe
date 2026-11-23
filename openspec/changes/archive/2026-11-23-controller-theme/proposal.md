## Why

Controller กำลังเปลี่ยนหน้าตาทั้งแอปตามแบบใหม่บน canvas "Veeloe Controller Redesign" (พื้นขาว การ์ดเทา ไม่มีเส้นและกรอบ ปุ่มหลักดำทรงแคปซูล สีของ Agent อยู่ที่ Character) แต่ token ใน `shared/ui/theme.ts` ตอนนี้กลับด้านกับแบบนั้น (พื้นเทา การ์ดขาวมีเงา) และ `shared/ui` ยังไม่มีชิ้นพื้นฐานที่แบบใหม่ใช้ หน้าจอจึงต่อ `View` และตั้งสีเอง (`useColors()` ถูกเรียกใน 23 ไฟล์นอก `shared/ui`) ถ้าเริ่มทำหน้าจอก่อนวางชั้นนี้ ทุกหน้าจะสร้าง Chip, Tabs และแถวที่กดได้ซ้ำกันเอง change นี้เป็นขั้นแรกของ redesign: เปลี่ยนชั้นล่างสุดก่อน เพื่อให้หน้าที่ใช้ `Section`, `Row` และ `Card` เปลี่ยนตามทันที และ change ถัดไป (`character-look`, `task-log-widgets`, `screens-redesign`) สร้างบนชิ้นเดียวกัน

## What Changes

- กระดานบน canvas redesign เป็นต้นแบบของหน้าจอแทน `controller-prototype` และกระดาน "Design system" บน canvas แทน design system artifact เดิม ต้องแก้ `controller/AGENTS.md` ให้ชี้ไปที่กระดาน
- **BREAKING (หน้าตา)** token ใน `theme.ts` เปลี่ยนเป็นพื้นจอขาว การ์ดเทา และเงาเฉพาะของที่ลอยอยู่เหนือเนื้อหา ทั้ง light และ dark
- ฟอนต์ของแอปเปลี่ยนจากฟอนต์ระบบเป็น Space Grotesk + Anuphan + JetBrains Mono ที่ฝังมากับแอป
- ขนาดตัวอักษรและน้ำหนักตามกระดาน Design system รวมถึงชื่อใหญ่และหัวจอที่หนักกว่าเดิม
- `shared/ui` เพิ่มชิ้นที่หน้าใหม่ต้องใช้ ได้แก่ `Chip`, `Tabs`, `Stat`, `Row` ที่สูง 52 กับไอคอนเปล่า, `Button` แบบ destructive และแบบลอย และ `Field` คู่ปุ่มสำหรับเพิ่มรายการในบรรทัดเดียว
- ตั้งกฎการใช้ element: page กับ widget ไม่มีสีหรือ hex ของตัวเอง และ `View` ใช้จัดวางเท่านั้น พื้น มุมโค้ง และเงาเป็นงานของ `shared/ui` กฎนี้มี ADR ใหม่และตัวตรวจใน `check:structure`
- ไม่เปลี่ยนโครงหน้าจอ ลำดับ หรือคำบนหน้าจอใน change นี้ หน้าที่เปลี่ยนหน้าตาจะเปลี่ยนเพราะ token และชิ้นใน `shared/ui` เท่านั้น

## Capabilities

### New Capabilities

- `controller-appearance`: หน้าตาพื้นฐานของ Controller ที่ผู้ใช้เห็นได้ ได้แก่ การตามโหมดสว่างและมืดของเครื่อง ฟอนต์ที่อ่านไทยและอังกฤษได้ตั้งแต่เปิดแอป ความหมายของสีสถานะ ขนาดจุดกด และการลดการเคลื่อนไหว

### Modified Capabilities

ไม่มี: `controller-character` ไม่เปลี่ยนใน change นี้ ชุดสีของ Agent ทรงกลม และ Mood ใหม่อยู่ใน change `character-look`

## Impact

- **Controller:**
  - `src/shared/ui/theme.ts`, `text.tsx`, `forms.tsx`, `card.tsx`, `button.tsx` และไฟล์ใหม่ใน `src/shared/ui/`
  - `src/app/layouts/RootLayout.tsx` สำหรับโหลดฟอนต์
  - หน้าที่ใช้ `useColors()` เพื่อตั้งพื้นหรือมุมโค้งเอง ต้องย้ายไปใช้ชิ้นใน `shared/ui`
- **Dependencies:** `expo-font` และแพ็กเกจฟอนต์ ติดตั้งด้วย `bunx expo install` ขนาดแอปใหญ่ขึ้นตามไฟล์ฟอนต์
- **โครงสร้าง:** ADR ใหม่สำหรับกฎการใช้ element และกฎใหม่ใน `controller/.conventions/rules.json` พร้อมไฟล์ที่ต้องถูกปฏิเสธและผ่าน
- **เอกสาร:** `controller/AGENTS.md` (ต้นแบบหน้าจอและ design system) และกระดาน Design system บน canvas ที่ต้องมี dark mode ก่อนเริ่มเขียนโค้ด
- **ไม่เปลี่ยน:** Runtime, Hub, Protocol และข้อมูลในเครื่อง
- **Change ที่ค้างอยู่:** `agent-memory-page` และ `push-notifications` แตะหน้าที่หน้าตาจะเปลี่ยน ควรปิดก่อน หรือ rebase หลัง change นี้
