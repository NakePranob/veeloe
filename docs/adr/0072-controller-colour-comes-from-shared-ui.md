# สีของ Controller มาจาก `shared/ui` เท่านั้น และ View มีไว้จัดวาง

Status: accepted

เพิ่มเติม ADR 0022 และ ADR 0070 (กฎข้อใหม่ใน `controller/.conventions/rules.json`)

`controller/AGENTS.md` เขียนไว้แล้วว่า "Colours come from `src/shared/ui/theme.ts` only" แต่ก่อน redesign มี 23 ไฟล์ใน `pages`, `widgets` และ `entities` ที่เรียก `useColors()` เพื่อตั้งพื้น มุมโค้ง หรือ spinner เอง และ `pages/agent-character` มี hex ของตัวเอง เมื่อแบบบน canvas เปลี่ยนพื้นจอเป็นขาวและการ์ดเป็นเทา หน้าที่ตั้งสีเองจึงไม่เปลี่ยนตาม token และแต่ละหน้าก็สร้าง Chip, แถวที่กดได้ และหน้าเต็มจอขึ้นมาเองซ้ำกัน

**การตัดสินใจ:**

- **ไฟล์ใน `src/pages` และ `src/widgets` ไม่ import `useColors` หรือ `useShadows` และไม่มี hex สี** สีตัวอักษรใช้ `Text` ผ่าน `tone` ส่วนพื้น การ์ด ป้าย spinner แถวที่กดได้ และหน้าเต็มจอ ใช้ชิ้นใน `shared/ui` (`Card`, `Chip`, `Tabs`, `Tile`, `Tap`, `Spinner`, `Centered` และอื่นๆ)
- **`View` ใช้จัดวาง** ทั้ง `flexDirection`, `gap`, `padding`, `flex` และขนาด ส่วนพื้น มุมโค้ง และเงาเป็นงานของ `shared/ui` ส่วนนี้ไม่มีตัวตรวจ เพราะการ import `useColors` เป็นทางเดียวที่หน้าจะได้ค่าสีมาตั้งเอง
- **`entities` ใช้สีได้** เพราะ `Character` วาดหัวจากสีของ Agent และมีสีจอของตัวเอง
- **ข้อยกเว้นชั่วคราว** อยู่ใน `rules.json` พร้อมชื่อ change ที่จะลบ: `pages/task/ui` (`task-thread-redesign`) และ `pages/agent-character` (`character-look`)

กฎนี้คือ `colour-from-shared-ui` ใน `controller/.conventions/rules.json` ตรวจโดย `controller/scripts/check-structure.ts`

## Considered Options

- **ตรวจทุก `style={}` ว่ามีแค่ค่าจัดวาง:** จับได้ครบกว่า แต่ต้อง parse JSX และแยก `gap` ออกจาก `backgroundColor` ในทุกรูปแบบที่เขียนได้ ตัวตรวจจะซับซ้อนกว่าปัญหา
- **เขียนไว้ใน AGENTS.md อย่างเดียว:** เป็นสภาพก่อน ADR นี้ และหน้าจอก็ยังตั้งสีเองอยู่ดี
- **ห้ามสีใน `entities` ด้วย:** `Character` ต้องผสมสีของ Agent เอง จะต้องย้ายการวาดหัวไป `shared/ui` ซึ่งไม่ใช่ที่ของมัน

## Consequences

- ของที่หน้าต้องการแต่ `shared/ui` ยังไม่มี เพิ่มเข้า `shared/ui` และวาดบนกระดาน Design system พร้อมกัน
- ส่งสีผ่าน prop จาก entity ยังเลี่ยงกฎได้ ถ้าเจอทางที่เกิดจริง ให้เพิ่มเป็นไฟล์ที่ต้องถูกปฏิเสธในกฎ
