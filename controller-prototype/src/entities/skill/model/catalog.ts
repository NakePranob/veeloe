import { file, type SkillFile } from "./skills";

// ponytail: stands in for what the app would download from a link or read from a dropped
// folder. Unknown links fail, as an unreachable repo would.

export interface Package {
  name: string;
  description: string;
  files: SkillFile[];
}

const REVIEW = (extra: string) => ({
  name: "pr-review-checklist",
  description: "ไล่รีวิว PR ตามรายการเดียวกันทุกครั้ง",
  files: [file("SKILL.md", `---\nname: pr-review-checklist\ndescription: ใช้เมื่อต้องรีวิว PR ให้ไล่ตามรายการเดียวกันทุกครั้ง\n---\n\n# รีวิว PR\n\n1. อ่าน diff ทั้งหมดก่อน\n2. เช็กว่ามี test ครอบการเปลี่ยนแปลง\n3. migration ต้องมี index ที่ query ใช้\n${extra}`)],
});

const NOTES = (v: 1 | 2): Package => ({
  name: "release-notes",
  description: "เขียน release notes จาก git log",
  files: [
    file("SKILL.md", `---\nname: release-notes\ndescription: ใช้เมื่อต้องเขียน release notes จาก git log\n---\n\n# Release notes\n\nอ่าน \`git log\` ระหว่างสอง tag แล้วจัดกลุ่มเป็น ใหม่ แก้ และเปลี่ยนแปลง\n${v === 2 ? "\nถ้าเป็น commit ที่ปิด issue ให้ใส่เลข issue ท้ายบรรทัด\n" : ""}`),
    file("template.md", v === 1 ? "## เวอร์ชัน {{version}}\n\n### ใหม่\n\n### แก้\n" : "## เวอร์ชัน {{version}}\n\n### ใหม่\n\n### แก้\n\n### เปลี่ยนแปลงที่ทำให้พัง\n"),
    ...(v === 2 ? [file("scripts/tag-range.sh", "#!/bin/sh\ngit describe --tags --abbrev=0 HEAD^\n")] : []),
  ],
});

// Each link has versions, newest last, so a check for a new one has something to find.
const LINKS: Record<string, Package[]> = {
  "https://github.com/acme/pr-review-checklist": [REVIEW(""), REVIEW("4. ถ้าแก้ API ต้องมีบันทึกใน CHANGELOG\n")],
  "https://github.com/acme/release-notes": [NOTES(1), NOTES(2)],
  "https://github.com/acme/translate-th": [
    { name: "translate-th", description: "แปลเอกสารเป็นไทยโดยคงคำเทคนิคเป็นอังกฤษ", files: [file("SKILL.md", "---\nname: translate-th\ndescription: แปลเอกสารเป็นไทย คงคำเทคนิคเป็นอังกฤษ\n---\n\nแปลทีละย่อหน้า ห้ามแปลชื่อคำสั่งหรือชื่อ API\n"), file("glossary.md", "- Agent: Agent\n- Budget: Budget\n- Approval: Approval\n")] },
  ],
  "https://github.com/acme/huge-dataset": [
    { name: "huge-dataset", description: "ชุดข้อมูลตัวอย่างขนาดใหญ่", files: [file("SKILL.md", "---\nname: huge-dataset\ndescription: ตัวอย่างที่ใหญ่เกินเพดาน\n---\n"), { path: "data/sample.bin", content: "(binary)", size: 6 * 1024 * 1024 }] },
  ],
};

export const KNOWN_LINKS = Object.keys(LINKS);

export function fetchLink(url: string, version?: number): Package | undefined {
  const versions = LINKS[url.trim().replace(/\/$/, "")];
  return versions?.[(version ?? versions.length) - 1];
}

export const latestVersion = (url: string) => LINKS[url]?.length ?? 0;

// What the app reads from a folder or zip the Member picks on this device.
export const LOCAL_PACKAGES: Record<string, Package> = {
  "standup-notes": { name: "standup-notes", description: "สรุป standup ของทีมจากแชต", files: [file("SKILL.md", "---\nname: standup-notes\ndescription: สรุป standup ของทีมให้เป็นสามหัวข้อ\n---\n\nแบ่งเป็น ทำแล้ว กำลังทำ ติดอะไร\n")] },
  "sql-style": { name: "sql-style", description: "แนวเขียน SQL ของทีม", files: [file("SKILL.md", "---\nname: sql-style\ndescription: ใช้เมื่อเขียนหรือรีวิว SQL\n---\n\nตัวพิมพ์เล็กทั้งหมด ชื่อตารางเป็นเอกพจน์\n"), file("scripts/lint.sh", "#!/bin/sh\nsqlfluff lint \"$@\"\n")] },
};

// What an Agent might write into its Workdir for a Member to install.
const DRAFTS: Package[] = [
  { name: "flaky-triage", description: "แยก test ที่ flaky ออกจากที่พังจริง", files: [file("SKILL.md", "---\nname: flaky-triage\ndescription: ใช้เมื่อ test พังเป็นพักๆ\n---\n\n1. รัน test เดิมซ้ำ 3 ครั้ง\n2. ถ้าผ่านบางครั้ง จดชื่อ test ลง `flaky.md`\n")] },
  { name: "deploy-checklist", description: "รายการที่ต้องเช็กก่อน deploy", files: [file("SKILL.md", "---\nname: deploy-checklist\ndescription: ใช้ก่อน deploy ขึ้น production\n---\n\n- test ผ่านทั้งหมด\n- ไม่มีไฟล์ค้างใน git\n- ขอ Approval ก่อนรัน deploy\n")] },
];

let next = 0;
export const nextDraftPackage = () => DRAFTS[next++ % DRAFTS.length];
