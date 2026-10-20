# ใช้ Ed25519 ด้วย @noble ทั้งระบบ และเก็บกุญแจใน Keychain/Keystore ของ OS

ฝั่ง TypeScript ทุกที่ (Runtime บน Bun, Controller บน Hermes และบนเว็บ) ใช้ @noble (curves, ciphers, hashes) เพราะเป็น JS ล้วนที่ผ่าน audit แล้ว และใช้ตัวเดียวได้ทุกที่ ลายเซ็นทั้งของ Controller และของ Runtime ใช้ Ed25519 ส่วน sealed box สำหรับ key ของ Provider (ADR 0005) ประกอบเองจาก X25519 กับ XSalsa20-Poly1305 ให้ตรงกับรูปแบบของ libsodium บนมือถือต้องเติม getRandomValues จาก expo-crypto ฝั่ง Hub ใช้ Ed25519 จาก stdlib ของ Go ไว้ตรวจตัวตนตอนต่อเข้ามาเท่านั้น

กุญแจบนมือถือเก็บด้วย expo-secure-store (Keychain/Keystore) บนเว็บเก็บใน IndexedDB และบน Machine เก็บเป็นไฟล์สิทธิ์ 0600 ในโฟลเดอร์ของ Runtime

## Considered Options

- **libsodium**: มี sealed box สำเร็จรูป แต่ต้องใช้สอง package (WASM กับ native) และฝั่งมือถือต้องใช้ native module
- **P-256 ในชิปความปลอดภัย (Secure Enclave, StrongBox)**: ดึงกุญแจออกมาไม่ได้ จึงปลอดภัยที่สุด แต่ต้องใช้ native module และระบบจะมีสอง algorithm

## Consequences

- แอปยังดึงกุญแจออกมาใช้ได้ malware ที่ยึดมือถือได้จึงขโมยกุญแจของ Owner ได้ ถ้าจะย้ายไปใช้ชิปความปลอดภัยทีหลัง ให้กุญแจเก่าเซ็นรับรองกุญแจใหม่ด้วยขั้นตอนเดียวกับการเพิ่ม Controller ตัวใหม่ โดยไม่ต้องทำ Pairing ใหม่
- Controller บนเว็บปลอดภัยน้อยกว่าบนมือถือ เพราะ IndexedDB ไม่ได้มีฮาร์ดแวร์ช่วยป้องกัน
