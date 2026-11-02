import { createStore } from "../../../shared/lib";

let counter = 0;

// A Project is the place work happens: files, a wiki, rights and who may work there. Who does the
// work is one Agent or a Team (ADR 0064). Its rights are its own, on top of the Agent Grants (ADR 0046).

export type ProjectRight = "view" | "ask" | "use" | "manage";
export const RIGHT_LABEL: Record<ProjectRight, string> = { view: "View", ask: "Ask", use: "Use", manage: "Manage" };
export const RIGHT_DETAIL: Record<ProjectRight, string> = {
  view: "เห็น Task และ wiki",
  ask: "ถามได้ด้วย Ask",
  use: "สั่งงานและกด Stop",
  manage: "ให้สิทธิ์ จัดรายชื่อผู้ทำงาน และตั้งค่า Project",
};
const RANK: Record<ProjectRight, number> = { view: 1, ask: 2, use: 3, manage: 4 };

// Only a starting value for the Project's settings, not a separate system (ADR 0047).
export type Template = "code" | "docs" | "design" | "external";
export const TEMPLATES: Record<Template, { label: string; detail: string; repos: string[]; worktree: boolean; skills: string[] }> = {
  code: { label: "โค้ด", detail: "repo จริงที่ clone เข้ามา ติ๊ก Worktree ไว้ก่อน", repos: ["app"], worktree: true, skills: ["code-review", "test-runner"] },
  docs: { label: "เอกสารและ research", detail: "Runtime สร้าง repo ไฟล์งานให้บนเครื่อง ต้นฉบับเป็น Markdown", repos: ["docs"], worktree: true, skills: ["export-docx", "web-research"] },
  design: { label: "ดีไซน์และสื่อ", detail: "ไฟล์ binary รวมด้วย git ไม่ได้ จึงปิด Worktree ไว้ก่อน", repos: ["assets"], worktree: false, skills: ["export-svg"] },
  external: { label: "งานผ่านระบบอื่น", detail: "ไม่มี repo แต่ละ Task ได้โฟลเดอร์ว่างของตัวเอง", repos: [], worktree: true, skills: [] },
};

export interface WikiPage {
  title: string;
  text: string;
}

// Who takes a Task of a Project: one Agent or a Team.
export interface Doer {
  kind: "agent" | "team";
  id: string;
}

// Agents on one Machine with one Entry, which may work in several Projects (ADR 0064).
export interface Team {
  id: string;
  name: string;
  machineId: string;
  // Every employee, the Entry included.
  employees: string[];
  entry: string;
  // What each employee is for, which the Entry reads to choose who gets a job (ADR 0045).
  roles: Record<string, string>;
  // Delegations an Entry may send in one Turn (ADR 0045).
  cap: number;
}

export interface Project {
  id: string;
  name: string;
  template: Template;
  machineId: string;
  // Who may be picked for a Task here. Getting on the list is the Agents' consent (ADR 0064).
  doers: Doer[];
  // By Member id. An Owner has Manage everywhere without being listed.
  rights: Record<string, ProjectRight>;
  // Where an Ask Turn's sandbox does not open, and what it is asked not to answer (ADR 0046).
  forbiddenPaths: string[];
  forbiddenTopics: string[];
  // Tasks that search cannot find and View and Ask cannot see.
  closedToAsk: string[];
  repos: string[];
  worktreeDefault: boolean;
  skills: string[];
  // Empty until the Project has someone to write it.
  wikiWriter: string;
  wiki: WikiPage[];
}

// A worktree of every repo of the Project for one Task, all on one branch (ADR 0047).
export interface Worktree {
  taskId: string;
  project: string;
  branch: string;
  // Empty when the Project has no repo: the Task gets an empty folder instead.
  repos: string[];
  folder: string;
  state: "open" | "merged" | "removed";
  // Files changed, which a merge brings back.
  changed: number;
  // Runtime gives each worktree its own PORT so dev servers do not collide.
  port: number;
}

type Who = { id: string; owner: boolean; removed?: boolean };

export function rightOf(project: Project | undefined, member: Who | undefined): ProjectRight | null {
  if (!project || !member || member.removed) return null;
  // ponytail: an Owner is Manage on every Project, as they are on every Agent.
  if (member.owner) return "manage";
  return project.rights[member.id] ?? null;
}

export function hasRight(project: Project | undefined, member: Who | undefined, level: ProjectRight) {
  const right = rightOf(project, member);
  return !!right && RANK[right] >= RANK[level];
}

// Files no Ask Turn reads whatever the Project says (ADR 0046).
const SECRET = /(^|\/)(\.env[^/]*|id_rsa[^/]*|[^/]*\.pem|[^/]*\.key|credentials[^/]*)$/;

const norm = (path: string) => path.trim().replace(/^\.?\//, "");

// Why a path is closed to an Ask Turn, or null when it may be read.
export function pathClosed(project: Project | undefined, path: string): string | null {
  const clean = norm(path);
  if (SECRET.test(clean)) return "ไฟล์ลับที่ห้ามเสมอ";
  const hit = project?.forbiddenPaths.find((entry) => clean === norm(entry) || clean.startsWith(`${norm(entry).replace(/\/$/, "")}/`));
  return hit ? `Project ห้าม ${hit}` : null;
}

// Delegation runs from an Entry to each other employee. A loop across all the Teams of
// one Machine would have two Agents holding Turns for each other (ADR 0045, 0064).
export function findCycle(all: Team[], machineId: string): { teams: string[]; path: string[] } | null {
  const edges = new Map<string, { to: string; team: string }[]>();
  for (const team of all.filter((candidate) => candidate.machineId === machineId)) {
    for (const employee of team.employees) {
      if (employee !== team.entry) edges.set(team.entry, [...(edges.get(team.entry) ?? []), { to: employee, team: team.name }]);
    }
  }
  // The stack holds each Agent with the Team whose edge led to it.
  const stack: { node: string; via: string }[] = [];
  const done = new Set<string>();
  let found: { teams: string[]; path: string[] } | null = null;
  function walk(node: string, via: string) {
    if (found || done.has(node)) return;
    const at = stack.findIndex((entry) => entry.node === node);
    if (at >= 0) {
      const loop = stack.slice(at);
      found = { teams: [...new Set([...loop.slice(1).map((entry) => entry.via), via])], path: [...loop.map((entry) => entry.node), node] };
      return;
    }
    stack.push({ node, via });
    for (const edge of edges.get(node) ?? []) walk(edge.to, edge.team);
    stack.pop();
    done.add(node);
  }
  for (const node of edges.keys()) walk(node, "");
  return found;
}

const teams = createStore<Team[]>([
  {
    id: "checkout-crew",
    name: "ทีม Release",
    machineId: "mac-studio",
    employees: ["reviewer", "deployer"],
    entry: "reviewer",
    roles: { reviewer: "รับงานทุกอย่างในห้อง รีวิวโค้ดและแบ่งงานให้คนอื่น", deployer: "ใช้เมื่อต้อง deploy หรือเช็ก pipeline" },
    cap: 5,
  },
]);

export const useTeams = teams.use;
export const getTeams = teams.get;

export function useTeam(id: string | undefined) {
  return useTeams().find((team) => team.id === id);
}

export function getTeam(id: string | undefined) {
  return teams.get().find((team) => team.id === id);
}

export function createTeam(input: Pick<Team, "name" | "machineId" | "employees" | "entry" | "roles">) {
  const team: Team = { ...input, id: `team-${++counter}`, cap: 5 };
  teams.set((all) => [...all, team]);
  return team;
}

export function updateTeam(id: string, patch: Partial<Team>) {
  teams.set((all) => all.map((team) => (team.id === id ? { ...team, ...patch } : team)));
}

export function deleteTeam(id: string) {
  teams.set((all) => all.filter((team) => team.id !== id));
}

export const doerKey = (doer: Doer) => `${doer.kind}:${doer.id}`;
export function doerFromKey(key: string): Doer {
  const [kind, id] = key.split(":");
  return { kind: kind as Doer["kind"], id };
}

// Every Agent that works when this one is picked.
export function doerAgents(doer: Doer, all = teams.get()) {
  return doer.kind === "agent" ? [doer.id] : (all.find((team) => team.id === doer.id)?.employees ?? []);
}

// The Agent a Task is opened with: the Agent itself, or the Team's Entry.
export function doerOwner(doer: Doer, all = teams.get()) {
  return doer.kind === "agent" ? doer.id : (all.find((team) => team.id === doer.id)?.entry ?? "");
}

export function projectAgents(project: Project, all = teams.get()) {
  return [...new Set(project.doers.flatMap((doer) => doerAgents(doer, all)))];
}

const projects = createStore<Project[]>([
  {
    id: "checkout",
    name: "Checkout 2.4",
    template: "code",
    machineId: "mac-studio",
    doers: [{ kind: "team", id: "checkout-crew" }, { kind: "agent", id: "deployer" }],
    rights: { m_nok: "use", m_mint: "view" },
    forbiddenPaths: ["secrets/", "config/prod"],
    forbiddenTopics: ["เงินเดือน"],
    closedToAsk: [],
    repos: ["app", "api"],
    worktreeDefault: true,
    skills: ["code-review", "test-runner"],
    wikiWriter: "reviewer",
    wiki: [
      { title: "ภาพรวม", text: "Checkout 2.4 แยกหน้าชำระเงินออกจาก cart และเพิ่ม index ให้ตาราง orders\nrepo `app` คือหน้าจอ repo `api` คือ backend" },
      { title: "วิธี deploy", text: "deploy ขึ้น production ผ่าน deployer เท่านั้น ต้องผ่าน test ก่อน และ Approval ไปที่คนดูแล deployer" },
    ],
  },
  {
    id: "research-q4",
    name: "Research ลูกค้า Q4",
    template: "docs",
    machineId: "build-box",
    doers: [{ kind: "agent", id: "tester" }],
    rights: { m_nok: "ask" },
    forbiddenPaths: ["interviews/raw"],
    forbiddenTopics: [],
    closedToAsk: [],
    repos: ["docs"],
    worktreeDefault: true,
    skills: ["export-docx", "web-research"],
    wikiWriter: "tester",
    wiki: [{ title: "คำถามสัมภาษณ์", text: "ถามเรื่องขั้นตอนชำระเงิน เหตุผลที่ทิ้งตะกร้า และสิ่งที่อยากให้เพิ่ม" }],
  },
]);

export const useProjects = projects.use;
export const getProjects = projects.get;
export const subscribeProjects = projects.subscribe;

export function useProject(id: string | undefined) {
  return useProjects().find((project) => project.id === id);
}

export function getProject(id: string | undefined) {
  return projects.get().find((project) => project.id === id);
}

export function createProject(input: Pick<Project, "name" | "template" | "machineId" | "doers" | "repos" | "worktreeDefault" | "skills">, creator: string) {
  const project: Project = {
    ...input,
    id: `project-${++counter}`,
    rights: { [creator]: "manage" },
    forbiddenPaths: [],
    forbiddenTopics: [],
    closedToAsk: [],
    wikiWriter: input.doers[0] ? doerOwner(input.doers[0]) : "",
    wiki: [],
  };
  projects.set((all) => [...all, project]);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>) {
  projects.set((all) => all.map((project) => (project.id === id ? { ...project, ...patch } : project)));
}

export function deleteProject(id: string) {
  projects.set((all) => all.filter((project) => project.id !== id));
  worktrees.set((all) => all.filter((worktree) => worktree.project !== id));
}

export function setRight(id: string, memberId: string, right: ProjectRight | null) {
  projects.set((all) =>
    all.map((project) => {
      if (project.id !== id) return project;
      const rights = { ...project.rights };
      if (right) rights[memberId] = right;
      else delete rights[memberId];
      return { ...project, rights };
    }),
  );
}

export function writeWiki(id: string, page: WikiPage) {
  projects.set((all) =>
    all.map((project) => {
      if (project.id !== id) return project;
      const has = project.wiki.some((candidate) => candidate.title === page.title);
      return { ...project, wiki: has ? project.wiki.map((candidate) => (candidate.title === page.title ? page : candidate)) : [...project.wiki, page] };
    }),
  );
}

const worktrees = createStore<Worktree[]>([]);
export const useWorktrees = worktrees.use;
export const getWorktrees = worktrees.get;

export function useWorktree(taskId: string | undefined) {
  return useWorktrees().find((worktree) => worktree.taskId === taskId);
}

export function getWorktree(taskId: string) {
  return worktrees.get().find((worktree) => worktree.taskId === taskId);
}

export function createWorktree(project: Project, taskId: string) {
  const worktree: Worktree = {
    taskId,
    project: project.id,
    branch: `veeloe/${taskId}`,
    repos: project.repos,
    folder: project.repos.length ? `projects/${project.id}/worktrees/${taskId}/` : `projects/${project.id}/tasks/${taskId}/`,
    state: "open",
    changed: 0,
    port: 3100 + worktrees.get().length + 1,
  };
  worktrees.set((all) => [...all, worktree]);
  return worktree;
}

export function updateWorktree(taskId: string, patch: Partial<Worktree>) {
  worktrees.set((all) => all.map((worktree) => (worktree.taskId === taskId ? { ...worktree, ...patch } : worktree)));
}
