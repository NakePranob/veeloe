// ponytail: what each Agent would put in its proposal after looking at its Workdir. The real
// Agent writes it in a Turn; the Member reads it whole and signs once (ADR 0056).
export interface Proposal {
  text: string;
  // Days it has been waiting, and a rough length in minutes.
  days: number;
  minutes: number;
}

const COMMON: Proposal[] = [
  { text: "ย่อ MEMORY.md ให้ไม่เกิน 4,000 ตัวอักษร", days: 6, minutes: 3 },
  { text: "ลบไฟล์ชั่วคราวใน Workdir ที่เก่ากว่า 14 วัน", days: 2, minutes: 4 },
];

export const PROPOSALS: Record<string, Proposal[]> = {
  tester: [
    { text: "หา test ที่ flaky จากผล 7 วันล่าสุด", days: 9, minutes: 8 },
    { text: "ลบ snapshot ที่ไม่มี test อ้างถึง", days: 4, minutes: 4 },
    { text: "รัน `npm run deploy:staging` เพื่อเช็กว่า build ล่าสุดขึ้นได้", days: 3, minutes: 6 },
    { text: "เขียน coverage ของโมดูล auth ใหม่ทั้งหมด", days: 2, minutes: 40 },
  ],
  writer: [{ text: "เช็กลิงก์เสียใน docs/", days: 12, minutes: 7 }, { text: "ร่าง release notes ของเวอร์ชันถัดไปจาก git log", days: 5, minutes: 10 }, ...COMMON],
  reviewer: [{ text: "สรุป PR ที่ merge แล้วของสัปดาห์นี้ลงไฟล์", days: 3, minutes: 6 }, { text: "ไล่หา TODO ที่เก่ากว่า 30 วันใน repo", days: 8, minutes: 9 }, ...COMMON],
  deployer: [{ text: "เช็กว่า image ที่ deploy อยู่ตรงกับ tag ล่าสุด", days: 4, minutes: 5 }, { text: "รัน `npm run deploy:prod` ให้ครบทุกเครื่อง", days: 1, minutes: 12 }],
};

export const proposalFor = (agentId: string): Proposal[] => PROPOSALS[agentId] ?? COMMON;
