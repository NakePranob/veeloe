import { createStore } from "../../../shared/lib";

// A Blueprint is an Agent template someone else made. The app shows what it asks for, a Member
// with Manage signs over its hash, and the result is a plain Agent on the customer's own Provider
// and Budget. Nothing in it runs as a plugin (ADR 0049).

export interface BlueprintSkill {
  name: string;
  description: string;
  files: { path: string; content: string }[];
}

export interface Blueprint {
  id: string;
  name: string;
  // Shown as written by the maker; the app does not vouch for it.
  author: string;
  source: string;
  summary: string;
  version: number;
  instructions: string;
  skills: BlueprintSkill[];
  // Connectors it needs; installing does not connect an account (ADR 0039).
  connectors: string[];
  // Bash prefixes and Connector tools that would run with no Approval (ADR 0030).
  allowlist: string[];
  // Domains it would add to the Machine's Egress (ADR 0008).
  egress: string[];
  // A Character in the Agent's own look, as plain values for the Agent screen to validate.
  character: { color: string; shell: string; top: string; sides: string; decal: string };
}

// ponytail: a non-cryptographic hash stands in for the SHA-256 the signed install carries.
export function blueprintHash(blueprint: Blueprint) {
  const text = JSON.stringify([blueprint.version, blueprint.instructions, blueprint.skills, blueprint.connectors, blueprint.allowlist, blueprint.egress, blueprint.character]);
  let a = 0x811c9dc5;
  let b = 5381;
  let out = "";
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
      b = ((b << 5) + b + text.charCodeAt(i) + round) >>> 0;
    }
    out += a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }
  return out;
}

const READ = ["ls", "cat", "head", "tail", "git status", "git log"];

// ponytail: the catalogue is a few entries read from a public list; the real one is fetched (ADR 0049).
export const BLUEPRINTS: Blueprint[] = [
  {
    id: "shop-support",
    name: "ผู้ช่วยตอบลูกค้าร้านค้า",
    author: "acme-labs",
    source: "https://github.com/acme-labs/veeloe-blueprints/shop-support",
    summary: "ตอบคำถามลูกค้าจากไฟล์ FAQ ใน Workdir เหมาะจะผูกกับ Channel",
    version: 2,
    instructions: "คุณคือผู้ช่วยของร้านค้า ตอบลูกค้าสั้นๆ สุภาพ ใช้ภาษาเดียวกับลูกค้า ตอบจากไฟล์ faq/*.md เท่านั้น ถ้าไม่มีคำตอบให้บอกว่าจะให้พนักงานติดต่อกลับ ห้ามรับปากเรื่องราคาหรือการคืนเงิน",
    skills: [{ name: "faq-lookup", description: "ค้นคำตอบจาก faq/ ก่อนตอบทุกครั้ง", files: [{ path: "SKILL.md", content: "---\nname: faq-lookup\ndescription: ค้นคำตอบจาก faq/ ก่อนตอบลูกค้า\n---\n\nใช้ `cat faq/*.md` หาหัวข้อที่ตรงกับคำถาม แล้วตอบตามนั้น" }] }],
    connectors: [],
    allowlist: READ,
    egress: [],
    character: { color: "#92D5C8", shell: "capsule", top: "antenna", sides: "ears", decal: "lights" },
  },
  {
    id: "pr-reviewer",
    name: "ผู้รีวิว PR",
    author: "acme-labs",
    source: "https://github.com/acme-labs/veeloe-blueprints/pr-reviewer",
    summary: "อ่าน diff ของ PR เทียบกับรายการตรวจ และสรุปจุดที่น่าห่วง",
    version: 1,
    instructions: "คุณคือผู้รีวิวโค้ด อ่าน diff ทั้งหมดก่อนแสดงความเห็น เน้น performance, migration และ test ที่ขาด ระบุไฟล์กับบรรทัดทุกครั้ง ไม่แก้โค้ดเอง",
    skills: [{ name: "pr-checklist", description: "รายการตรวจ PR ที่ใช้ทุกครั้ง", files: [{ path: "SKILL.md", content: "---\nname: pr-checklist\ndescription: รายการตรวจ PR\n---\n\n1. อ่าน diff ทั้งหมด\n2. test ครอบการเปลี่ยนแปลงไหม\n3. migration มี index ไหม" }] }],
    connectors: ["github"],
    allowlist: [...READ, "gh pr diff", "gh pr view", "rg", "github/get_file", "github/list_pull_requests"],
    egress: ["github.com", "api.github.com"],
    character: { color: "#9DC3E6", shell: "dome", top: "twin", sides: "pods", decal: "brow" },
  },
  {
    id: "release-writer",
    name: "ผู้เขียน release notes",
    author: "docs-guild",
    source: "https://github.com/docs-guild/veeloe-blueprints/release-writer",
    summary: "อ่าน git log ระหว่างสอง tag แล้วเขียน release notes เป็น Markdown",
    version: 1,
    instructions: "คุณคือผู้เขียน release notes อ่าน git log แล้วจัดกลุ่มเป็น ใหม่ แก้ และเปลี่ยนแปลง เขียนเป็นภาษาที่ผู้ใช้เข้าใจ ไม่ใช่ชื่อ commit",
    skills: [{ name: "release-notes", description: "จัดกลุ่ม commit เป็น release notes", files: [{ path: "SKILL.md", content: "---\nname: release-notes\ndescription: เขียน release notes จาก git log\n---\n\nรัน `git log <tag>..HEAD` แล้วจัดกลุ่ม" }] }],
    connectors: [],
    allowlist: [...READ, "git tag", "git show"],
    egress: [],
    character: { color: "#C9B3E6", shell: "box", top: "fin", sides: "fins", decal: "grille" },
  },
  {
    id: "error-watcher",
    name: "ผู้เฝ้า error",
    author: "ops-collective",
    source: "https://github.com/ops-collective/veeloe-blueprints/error-watcher",
    summary: "ดู error ใหม่ใน Sentry และสรุปว่ามาจาก release ไหน ขอ Egress หลายโดเมน ควรอ่านก่อนติดตั้ง",
    version: 3,
    instructions: "คุณคือผู้เฝ้า error ดึง issue ใหม่จาก Sentry จัดกลุ่มตาม release และบอกว่าอะไรน่าจะพังเพราะ deploy ล่าสุด ไม่แก้ระบบเอง",
    skills: [],
    connectors: ["sentry"],
    allowlist: [...READ, "curl", "sentry/list_issues", "sentry/get_issue"],
    egress: ["sentry.io", "o1.ingest.sentry.io", "hooks.slack.com"],
    character: { color: "#F2A7B8", shell: "chamfer", top: "beacon", sides: "none", decal: "none" },
  },
];

export interface Install {
  blueprint: string;
  agent: string;
  hash: string;
  by: string;
  at: number;
}

const installs = createStore<Install[]>([]);
export const useInstalls = installs.use;

export function recordInstall(install: Omit<Install, "at">) {
  installs.set((all) => [...all, { ...install, at: Date.now() }]);
}
