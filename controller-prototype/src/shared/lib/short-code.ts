// Words that sound unlike each other, so two people can read a code across a phone call.
// 64 of them give six bits a word; four words are 24 bits.
const WORDS = [
  "แมว", "ดาว", "เรือ", "ภูเขา", "ช้าง", "ปลา", "นก", "ม้า",
  "เต่า", "กบ", "ฝน", "ลม", "ไฟ", "น้ำ", "ดิน", "ทราย",
  "ทะเล", "เกาะ", "สะพาน", "ประตู", "หน้าต่าง", "กุญแจ", "นาฬิกา", "ร่ม",
  "หมวก", "รองเท้า", "กระเป๋า", "หนังสือ", "ดินสอ", "กล้อง", "เทียน", "ระฆัง",
  "ธง", "มะม่วง", "กล้วย", "ส้ม", "องุ่น", "ข้าว", "ชา", "กาแฟ",
  "ใบไม้", "ดอกไม้", "ต้นไม้", "หิน", "เมฆ", "พระจันทร์", "อาทิตย์", "สายรุ้ง",
  "ลูกบอล", "ว่าว", "จักรยาน", "รถไฟ", "เครื่องบิน", "บอลลูน", "ภาพวาด", "ไวโอลิน",
  "กลอง", "กระดิ่ง", "แว่นตา", "ตะเกียง", "บันได", "เก้าอี้", "โต๊ะ", "ตู้เย็น",
];

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// The short code both screens show for one public key (ADR 0013, 0031), like Signal's safety number.
// ponytail: a hash of a stand-in string; the real one is a hash of the Ed25519 public key.
export function shortCode(key: string) {
  const hash = fnv1a(key);
  return [0, 6, 12, 18].map((shift) => WORDS[(hash >>> shift) & 63]);
}
