import { createStore } from "../../../shared/lib";

// A Skill is a folder with a SKILL.md, a setting of the Agent that a Member with Manage signs
// in, and the Agent can read but not change (ADR 0038).

export interface SkillFile {
  path: string;
  content: string;
  // Bytes; declared in the signed install, so an oversize Skill is refused before it is sent.
  size: number;
}

export type SkillOrigin = "link" | "file" | "draft" | "agent";
export const ORIGIN_LABEL: Record<SkillOrigin, string> = { link: "จากลิงก์", file: "จากไฟล์ในเครื่อง", draft: "ร่างที่ Agent เขียน", agent: "จาก Agent ตัวอื่น" };

// ponytail: a few MB so the Hub never becomes a way to move big files (ADR 0038).
export const MAX_SKILL_BYTES = 5 * 1024 * 1024;

export interface Skill {
  id: string;
  agent: string;
  name: string;
  description: string;
  origin: SkillOrigin;
  // The link, the file name or the Agent it came from, for the version check.
  from: string;
  version: number;
  files: SkillFile[];
  // What the install command signed: a change to any file after reading breaks it.
  hash: string;
  installedBy: string;
  signedDevice: string;
  installedAt: number;
}

// What the Agent wrote in its Workdir and offered for a Member to install.
export interface SkillDraft {
  id: string;
  agent: string;
  name: string;
  description: string;
  files: SkillFile[];
  proposedAt: number;
}

// ponytail: a small non-cryptographic hash stands in for the SHA-256 the signed command carries.
export function hashFiles(files: SkillFile[]) {
  let hash = 5381;
  for (const char of files.map((file) => `${file.path}\0${file.content}`).join("\u0001")) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export const totalBytes = (files: SkillFile[]) => files.reduce((sum, file) => sum + file.size, 0);

export const file = (path: string, content: string): SkillFile => ({ path, content, size: content.length });

const now = Date.now();
const DAY = 86_400_000;

const REVIEW_V1 = [
  file("SKILL.md", "---\nname: pr-review-checklist\ndescription: ใช้เมื่อต้องรีวิว PR ให้ไล่ตามรายการเดียวกันทุกครั้ง\n---\n\n# รีวิว PR\n\n1. อ่าน diff ทั้งหมดก่อน\n2. เช็กว่ามี test ครอบการเปลี่ยนแปลง\n3. migration ต้องมี index ที่ query ใช้\n"),
];
const NOTES_V1 = [
  file("SKILL.md", "---\nname: release-notes\ndescription: ใช้เมื่อต้องเขียน release notes จาก git log\n---\n\n# Release notes\n\nอ่าน `git log` ระหว่างสอง tag แล้วจัดกลุ่มเป็น ใหม่ แก้ และเปลี่ยนแปลง\n"),
  file("template.md", "## เวอร์ชัน {{version}}\n\n### ใหม่\n\n### แก้\n"),
];

const skills = createStore<{ skills: Skill[]; drafts: SkillDraft[] }>({
  skills: [
    { id: "skill-1", agent: "reviewer", name: "pr-review-checklist", description: "ไล่รีวิว PR ตามรายการเดียวกันทุกครั้ง", origin: "link", from: "https://github.com/acme/pr-review-checklist", version: 1, files: REVIEW_V1, hash: hashFiles(REVIEW_V1), installedBy: "m_nok", signedDevice: "d_nok_phone", installedAt: now - 12 * DAY },
    { id: "skill-2", agent: "writer", name: "release-notes", description: "เขียน release notes จาก git log", origin: "link", from: "https://github.com/acme/release-notes", version: 1, files: NOTES_V1, hash: hashFiles(NOTES_V1), installedBy: "m_kai", signedDevice: "d_kai_phone", installedAt: now - 30 * DAY },
  ],
  drafts: [],
});

export const useSkills = skills.use;
export const getSkills = skills.get;

let counter = 2;

export function installSkill(input: Omit<Skill, "id" | "hash" | "installedAt">) {
  const skill: Skill = { ...input, id: `skill-${++counter}`, hash: hashFiles(input.files), installedAt: Date.now() };
  skills.set((state) => ({ ...state, skills: [...state.skills.filter((item) => !(item.agent === skill.agent && item.name === skill.name)), skill] }));
  return skill;
}

export function removeSkill(id: string) {
  skills.set((state) => ({ ...state, skills: state.skills.filter((skill) => skill.id !== id) }));
}

export function addDraft(input: Omit<SkillDraft, "id" | "proposedAt">) {
  const draft: SkillDraft = { ...input, id: `draft-${++counter}`, proposedAt: Date.now() };
  skills.set((state) => ({ ...state, drafts: [...state.drafts, draft] }));
  return draft;
}

export function updateDraft(id: string, files: SkillFile[]) {
  skills.set((state) => ({ ...state, drafts: state.drafts.map((draft) => (draft.id === id ? { ...draft, files } : draft)) }));
}

export function removeDraft(id: string) {
  skills.set((state) => ({ ...state, drafts: state.drafts.filter((draft) => draft.id !== id) }));
}
