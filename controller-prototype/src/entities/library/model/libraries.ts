import { createStore } from "../../../shared/lib";

// A shared store of Markdown on one Machine, kept outside every Workdir. The Owner makes it;
// many Agents read it and one writes (ADR 0037).

export interface LibraryPage {
  path: string;
  content: string;
  // The Agent that last wrote it.
  by: string;
  at: number;
}

export type Access = "read" | "write";

export interface Library {
  id: string;
  name: string;
  machineId: string;
  // Agent id to what it may do; at most one entry is "write".
  access: Record<string, Access>;
  pages: LibraryPage[];
  createdBy: string;
}

const now = Date.now();
const HOUR = 3_600_000;

const store = createStore<Library[]>([
  {
    id: "engineering-wiki",
    name: "Engineering wiki",
    machineId: "mac-studio",
    createdBy: "m_kai",
    access: { reviewer: "write", deployer: "read" },
    pages: [
      { path: "index.md", by: "reviewer", at: now - 30 * HOUR, content: "# Engineering wiki\n\n- [[deploy-runbook]]\n- [[review-checklist]]\n- [[incident-2026-10]]\n\nอ่าน [[log]] เพื่อดูว่ามีอะไรเปลี่ยนล่าสุด\n" },
      { path: "log.md", by: "reviewer", at: now - 5 * HOUR, content: "# Log\n\n- 2026-11-01 เพิ่ม [[incident-2026-10]]\n- 2026-10-28 แก้ [[deploy-runbook]]\n" },
      { path: "deploy-runbook.md", by: "reviewer", at: now - 80 * HOUR, content: "# Deploy runbook\n\n1. test ผ่านทั้งหมด\n2. ขอ Approval ก่อนรัน `npm run deploy:prod`\n3. ถ้าพัง ดู [[incident-2026-10]] ก่อน rollback\n\nดูรายการรีวิวที่ [[review-checklist]]\n" },
      { path: "review-checklist.md", by: "reviewer", at: now - 120 * HOUR, content: "# Review checklist\n\n- migration ต้องมี index ที่ query ใช้\n- ต้องมี test ครอบ\n- ดู [[deploy-runbook]] ถ้า PR แตะ pipeline\n" },
      { path: "incident-2026-10.md", by: "reviewer", at: now - 5 * HOUR, content: "# Incident ตุลาคม\n\nสาเหตุ: deploy ไม่ผ่าน health check เพราะ migration ยังไม่รัน\nวิธีแก้: รัน migration ก่อน แล้ว [[deploy-runbook]] ข้อ 2\n" },
    ],
  },
  {
    id: "customer-faq",
    name: "FAQ ลูกค้า",
    machineId: "build-box",
    createdBy: "m_kai",
    access: { tester: "write" },
    pages: [
      { path: "index.md", by: "tester", at: now - 50 * HOUR, content: "# FAQ ลูกค้า\n\n- [[refund]]\n- [[login-problems]]\n" },
      { path: "refund.md", by: "tester", at: now - 50 * HOUR, content: "# คืนเงิน\n\nคืนได้ภายใน 7 วันหลังชำระ ติดต่อฝ่ายบัญชี ถ้าเข้าสู่ระบบไม่ได้ดู [[login-problems]]\n" },
      { path: "login-problems.md", by: "tester", at: now - 50 * HOUR, content: "# เข้าสู่ระบบไม่ได้\n\nรีเซ็ตรหัสผ่านทางอีเมล ถ้ายังไม่ได้ให้แจ้งทีมซัพพอร์ต\n" },
    ],
  },
]);

export const useLibraries = store.use;
export const getLibraries = store.get;

export const wikiLinks = (content: string) => [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim());
export const pageName = (path: string) => path.replace(/\.md$/, "");

let counter = 0;

export function createLibrary(name: string, machineId: string, createdBy: string) {
  const id = `${name.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "-").replace(/^-|-$/g, "") || "library"}-${++counter}`;
  const library: Library = { id, name, machineId, createdBy, access: {}, pages: [{ path: "index.md", by: "", at: Date.now(), content: `# ${name}\n\nสารบัญของคลังนี้ Agent ที่เขียนได้จะเพิ่มหน้าและลิงก์ด้วย [[...]]\n` }] };
  store.set((all) => [...all, library]);
  return library;
}

export function deleteLibrary(id: string) {
  store.set((all) => all.filter((library) => library.id !== id));
}

// One writer: giving "write" to an Agent turns the old writer into a reader.
export function setAccess(id: string, agentId: string, access: Access | null) {
  store.set((all) =>
    all.map((library) => {
      if (library.id !== id) return library;
      const next: Record<string, Access> = {};
      for (const [agent, level] of Object.entries(library.access)) if (agent !== agentId) next[agent] = access === "write" && level === "write" ? "read" : level;
      if (access) next[agentId] = access;
      return { ...library, access: next };
    }),
  );
}

export type WriteResult = { ok: true } | { ok: false; reason: string };

// What the sandbox enforces: only the writer may change a page (ADR 0037).
export function writePage(id: string, agentId: string, path: string, content: string): WriteResult {
  const library = store.get().find((candidate) => candidate.id === id);
  if (!library) return { ok: false, reason: "ไม่พบ Library" };
  const level = library.access[agentId];
  if (level !== "write") return { ok: false, reason: level === "read" ? "Agent นี้อ่าน Library ได้อย่างเดียว sandbox ไม่ให้เขียน" : "Agent นี้ไม่มีสิทธิ์ใน Library นี้" };
  store.set((all) =>
    all.map((candidate) =>
      candidate.id !== id
        ? candidate
        : { ...candidate, pages: candidate.pages.some((page) => page.path === path) ? candidate.pages.map((page) => (page.path === path ? { ...page, content, by: agentId, at: Date.now() } : page)) : [...candidate.pages, { path, content, by: agentId, at: Date.now() }] },
    ),
  );
  return { ok: true };
}

// A plain word match standing in for the Agent's grep over the pages (ADR 0037).
export function searchLibrary(library: Library, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  if (!words.length) return [];
  return library.pages
    .map((page) => ({ page, hits: words.filter((word) => page.content.toLowerCase().includes(word)).length }))
    .filter((match) => match.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

export const writerOf = (library: Library) => Object.entries(library.access).find(([, level]) => level === "write")?.[0];
