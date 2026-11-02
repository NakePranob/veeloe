import { charge, getAgent, type Agent } from "../../../entities/agent";
import { can, getCurrentMember, getCurrentMemberId, getMembers, memberName, type Member } from "../../../entities/member";
import { pushNotification } from "../../../entities/notification";
import {
  createWorktree,
  doerOwner,
  getProject,
  getTeam,
  getWorktree,
  getWorktrees,
  hasRight,
  pathClosed,
  rightOf,
  updateWorktree,
  writeWiki,
  type Doer,
  type Project,
  type Team,
} from "../../../entities/project";
import { append, createTask, eventsOf, getTask, getTasks, subscribeTasks, turnOpen, updateTask, type Attachment, type Effort, type Task } from "../../../entities/task";
import { createStore } from "../../../shared/lib";
import { enqueue, finish, getRuntime, later, sendMessage, setTurnHooks, spend, type QueueItem } from "./runtime";

// What a Project and a Team add to the Runtime, simulated: the Entry delegating one level (ADR 0045, 0064), the
// Turns that share a checkout or run in their own Worktree (ADR 0047), Ask (ADR 0046) and Mention.

let counter = 0;
const nextId = (prefix: string) => `${prefix}${++counter}`;

const rootOf = (task: Task): Task => (task.parent ? rootOf(getTask(task.parent) ?? { ...task, parent: undefined }) : task);

// Every Task under this one, parents before children.
export function descendants(id: string, tasks = getTasks()): Task[] {
  return tasks.filter((task) => task.parent === id).flatMap((task) => [task, ...descendants(task.id, tasks)]);
}

// Agents that cannot write their Workdir right now because a Turn of theirs runs in a Worktree (ADR 0047).
function workdirReadOnly(agentId: string, exceptTask: string) {
  return getTasks().some((task) => task.agent === agentId && task.worktree && task.id !== exceptTask && turnOpen(task.events));
}

// --- Mention (ADR 0046) ---------------------------------------------------

export interface Mentions {
  people: Member[];
  employees: Agent[];
  // Named but with no right in the Project, so they are only text.
  outside: string[];
}

// Employees are those of the Task's Team; a Task one Agent works on has none (ADR 0064).
export function parseMentions(text: string, project: Project | undefined, team?: Team): Mentions {
  const found: Mentions = { people: [], employees: [], outside: [] };
  if (!project) return found;
  for (const [, name] of text.matchAll(/@([^\s@.,;:!?]+)/g)) {
    const lower = name.toLowerCase();
    const employee = (team?.employees ?? []).map((id) => getAgent(id)).find((agent) => agent?.name.toLowerCase() === lower);
    const member = getMembers().find((candidate) => !candidate.removed && candidate.name.toLowerCase() === lower);
    if (employee) found.employees.push(employee);
    else if (member && rightOf(project, member)) found.people.push(member);
    else found.outside.push(name);
  }
  return found;
}

// A Mention waiting unread, per Task and person. An Agent repeating one while it waits sends no
// second push, so a tricked Agent cannot make a phone buzz again and again (ADR 0046).
const unread = new Set<string>();

export function notifyMentions(taskId: string, text: string, by: { member: string } | { agent: string }) {
  const task = getTask(taskId);
  const project = getProject(task?.project);
  if (!task || !project) return;
  const byAgent = "agent" in by;
  const who = byAgent ? (getAgent(by.agent)?.name ?? "Agent") : memberName(by.member);
  for (const person of parseMentions(text, project, getTeam(rootOf(task).team)).people) {
    if (!byAgent && person.id === by.member) continue;
    const key = `${taskId}|${person.id}`;
    if (byAgent && unread.has(key)) continue;
    unread.add(key);
    // The push says who, never what (ADR 0005).
    pushNotification({ kind: "mention", member: person.id, agent: task.agent, title: `${who} แท็กคุณ`, href: `/tasks/${taskId}?mention=1` });
  }
}

export function markMentionsRead(taskId: string, memberId: string) {
  unread.delete(`${taskId}|${memberId}`);
}

// --- Starting and sending --------------------------------------------------

// Opened from a Project's page: still a chat with the Agent or Team, with the place already picked.
export function startProjectTask(project: Project, doer: Doer) {
  const task = createTask({ agent: doerOwner(doer), team: doer.kind === "team" ? doer.id : undefined, title: "Task ใหม่", starter: getCurrentMemberId() });
  setTaskProject(task.id, project, project.worktreeDefault);
  return task;
}

// A chat with a Team, which is opened on the first Project it may work in for this Member (ADR 0064).
export function newTeamTask(team: Team, project: Project | undefined) {
  const task = createTask({ agent: team.entry, team: team.id, title: "Task ใหม่", starter: getCurrentMemberId() });
  if (project) setTaskProject(task.id, project, project.worktreeDefault);
  return task;
}

// Until the first message the chat may still change where it works.
export function setTaskProject(taskId: string, project: Project | undefined, worktree: boolean) {
  updateTask(taskId, project ? { project: project.id, source: "project", shared: true, worktree } : { project: undefined, source: "app", shared: false, worktree: false });
}

// A message in a Project's room: a Mention first, then the Entry's Turn.
export function sendInProject(taskId: string, text: string, effort: Effort, attachments: Attachment[] = []) {
  const task = getTask(taskId);
  const project = getProject(task?.project);
  // The Worktree is made when the chat is fixed to the Project, by its first message.
  if (task?.worktree && project && !getWorktree(taskId)) createWorktree(project, taskId);
  notifyMentions(taskId, text, { member: getCurrentMemberId() });
  sendMessage(taskId, text, effort, attachments);
}

// --- Locks: one writer per checkout or Worktree (ADR 0011, 0047) -----------

interface Waiter {
  taskId: string;
  run: () => void;
}

const holders = new Map<string, string>();
const waiters = new Map<string, Waiter[]>();
// Which Task a waiting Turn is waiting for, so the room can say so.
const waits = createStore<Record<string, string>>({});
export const useProjectWaits = waits.use;

const lockKey = (task: Task) => (task.worktree ? `wt:${rootOf(task).id}` : `main:${task.project}`);
// A Task's next Turn may take over the lock its earlier Turn held.
const lockBusy = (key: string, self: string) => {
  const holder = holders.get(key);
  return !!holder && holder !== self && turnOpen(eventsOf(holder));
};

function clearWait(taskId: string) {
  if (waits.get()[taskId]) waits.set(({ [taskId]: _gone, ...rest }) => rest);
}

function withLock(task: Task, run: () => void) {
  const key = lockKey(task);
  if (!lockBusy(key, task.id)) {
    holders.set(key, task.id);
    return run();
  }
  waiters.set(key, [...(waiters.get(key) ?? []), { taskId: task.id, run }]);
  waits.set((all) => ({ ...all, [task.id]: holders.get(key) ?? "" }));
}

// A holder's Turn ended (finished, stopped or interrupted), so the next waiting Turn goes.
function drain() {
  for (const [key, list] of waiters) {
    while (list.length && !lockBusy(key, list[0].taskId)) {
      const next = list.shift() as Waiter;
      clearWait(next.taskId);
      if (!turnOpen(eventsOf(next.taskId))) continue;
      holders.set(key, next.taskId);
      next.run();
    }
  }
}

// --- Work an employee does ---------------------------------------------------

const WIKI = /^(?:wiki|จดลง wiki)\s*[:：]?\s*([^:：]+?)\s*[:：]\s*([\s\S]+)$/i;

function bumpChanged(task: Task, by: number) {
  const tree = getWorktree(rootOf(task).id);
  if (tree?.state === "open" && tree.repos.length) updateWorktree(tree.taskId, { changed: tree.changed + by });
}

// A Turn that does the job itself with tools: reads, an edit in the checkout or Worktree, an answer.
function doWork(item: QueueItem, task: Task, project: Project) {
  const agent = getAgent(task.agent);
  if (!agent || !turnOpen(eventsOf(task.id)) || !spend(task.id, item.member)) return;
  const text = item.text.trim();
  const tree = getWorktree(rootOf(task).id);
  const where = tree ? `${tree.state === "open" ? "ใน branch " + tree.branch : "ในสำเนาที่ลบแล้ว"}` : "ใน checkout หลัก";
  const wiki = WIKI.exec(text);
  if (wiki && task.agent === project.wikiWriter) {
    // Only the writer edits the wiki, so two never write one page (ADR 0046).
    const id = nextId("t");
    later(task.id, 400, () => append(task.id, { type: "tool_call", id, command: `edit wiki/${wiki[1]}.md` }));
    later(task.id, 1600, () => {
      writeWiki(project.id, { title: wiki[1].trim(), text: wiki[2].trim() });
      append(task.id, { type: "tool_result", id, ok: true, output: `เขียนหน้า ${wiki[1].trim()} แล้ว` });
      finish(task.id, item.member, `จดหน้า **${wiki[1].trim()}** ลง wiki ของ Project แล้ว`);
    });
    return;
  }
  const keyword = text.replace(/@\S+/g, "").trim().split(/\s+/).find((word) => word.length > 3) ?? "TODO";
  const read = nextId("t");
  const edit = nextId("t");
  later(task.id, 400, () => append(task.id, { type: "tool_call", id: read, command: `rg -n "${keyword}" ${project.repos.length ? "repos/" : "tasks/"}` }));
  later(task.id, 1800, () => append(task.id, { type: "tool_result", id: read, ok: true, output: "พบ 6 จุด" }));
  // An employee cannot hand work on; the attempt is refused where it is made (ADR 0045).
  if (task.parent && /ส่งต่อ|ให้ตัวอื่น/.test(text)) {
    const root = rootOf(task);
    const other = getTeam(root.team)?.employees.find((id) => id !== task.agent && id !== root.agent);
    const hand = nextId("t");
    later(task.id, 2000, () => append(task.id, { type: "tool_call", id: hand, command: `delegate ${getAgent(other ?? root.agent)?.name ?? "Agent"}` }));
    later(task.id, 2600, () => append(task.id, { type: "tool_result", id: hand, ok: false, output: "ปฏิเสธ: พนักงานส่งงานต่อไม่ได้ มีแค่ Entry ที่ส่งงานได้ (ADR 0045) ถามกันได้ด้วย Ask" }));
  }
  later(task.id, 3000, () => append(task.id, { type: "tool_call", id: edit, command: project.repos.length ? "git commit -am 'update'" : "write tasks/notes.md" }));
  later(task.id, 4200, () => {
    append(task.id, { type: "tool_result", id: edit, ok: true, output: project.repos.length ? "แก้ 3 ไฟล์" : "เขียน 1 ไฟล์" });
    bumpChanged(task, 3);
    finish(task.id, item.member, `เสร็จแล้ว: ${text}\n\nผลอยู่${where} (${project.repos.length ? "รีวิวได้ที่ branch เดียวกัน" : "โฟลเดอร์ว่างของ Task นี้"})`);
  });
}

// --- The Entry delegating -----------------------------------------------------

interface Run {
  parent: string;
  project: string;
  team: string;
  // Whose name the whole tree runs under (ADR 0010).
  sender: string;
  instruction: string;
  // Agents to send to, one list per round. A later round sends back into the same Task.
  rounds: string[][];
  round: number;
  sent: number;
  refused: number;
  children: Record<string, string>;
  expect: { child: string; seq: number }[];
  started?: boolean;
  finishing?: boolean;
}

const runs = new Map<string, Run>();

function delegate(run: Run, agentId: string, instruction: string) {
  const project = getProject(run.project);
  const parent = getTask(run.parent);
  const agent = getAgent(agentId);
  const id = nextId("d");
  const team = getTeam(run.team);
  if (!project || !parent || !agent) return;
  append(run.parent, { type: "tool_call", id, command: `delegate ${agent.name} · "${instruction.slice(0, 48)}"` });
  const refuse = (reason: string) => {
    run.refused++;
    append(run.parent, { type: "tool_result", id, ok: false, output: reason });
  };
  // Checked on every send, in case the right was withdrawn on the way (ADR 0010).
  const sender = getMembers().find((member) => member.id === run.sender);
  if (!hasRight(project, sender, "use")) return refuse("ผู้สั่งไม่มีสิทธิ์ Use ใน Project นี้แล้ว ส่งงานไม่ได้");
  if (!team || !team.employees.includes(agentId) || agentId === parent.agent) return refuse(`${agent.name} ไม่ใช่พนักงานที่รับงานได้ใน Team นี้`);
  if (run.sent >= team.cap) return refuse(`ถึงเพดาน ${team.cap} ครั้งต่อ Turn แล้ว ทำเองหรือสรุปต่อได้ Turn นี้ยังไม่จบ`);
  run.sent++;
  const existing = run.children[agentId];
  let child = existing ? getTask(existing) : undefined;
  if (child) {
    append(child.id, { type: "message", text: instruction, member: run.sender });
    append(run.parent, { type: "tool_result", id, ok: true, output: `ส่งต่อใน Task ย่อยเดิม (ครั้งที่ ${run.sent}/${team.cap})` });
  } else {
    child = createTask({ agent: agentId, title: instruction.slice(0, 40), starter: run.sender, source: "project", shared: true, silent: true, project: project.id, parent: run.parent, worktree: parent.worktree });
    run.children[agentId] = child.id;
    append(child.id, { type: "message", text: instruction, member: run.sender });
    append(run.parent, { type: "tool_result", id, ok: true, output: `สร้าง Task ย่อยให้ ${agent.name} (ครั้งที่ ${run.sent}/${team.cap})` });
  }
  const seq = eventsOf(child.id).at(-1)?.seq ?? 0;
  run.expect.push({ child: child.id, seq });
  enqueue(agentId, { taskId: child.id, seq, member: run.sender, text: instruction });
}

function startRound(run: Run) {
  run.started = true;
  const first = run.round === 0;
  for (const agentId of run.rounds[run.round]) {
    delegate(run, agentId, first ? run.instruction : `ตีกลับรอบ ${run.round + 1}: ผลที่ส่งมายังไม่ครบ ช่วยตรวจอีกครั้งแล้วแก้ ${run.instruction}`);
  }
}

const settledAfter = (child: string, seq: number) => eventsOf(child).some((event) => event.seq > seq && (event.type === "turn_end" || event.type === "stop"));

function finalize(run: Run) {
  const parent = getTask(run.parent);
  runs.delete(run.parent);
  const project = getProject(run.project);
  if (!parent || !project || !turnOpen(parent.events)) return;
  const lines = Object.entries(run.children).map(([agentId, childId]) => {
    const events = eventsOf(childId);
    const name = getAgent(agentId)?.name ?? agentId;
    const stop = events.findLast((event) => event.type === "stop");
    const last = events.findLast((event) => event.type === "text");
    const stopped = stop?.type === "stop" && (!last || stop.seq > last.seq);
    if (stopped) return `- **${name}**: ถูก${memberName(stop.member)}หยุดก่อนเสร็จ`;
    const budget = events.findLast((event) => event.type === "budget_out");
    if (budget && (!last || budget.seq > last.seq)) return `- **${name}**: Budget ของวันนี้หมด ทำต่อไม่ได้`;
    return `- **${name}**: ${(last?.type === "text" ? last.text : "ไม่มีผล").split("\n")[0].slice(0, 90)}`;
  });
  const cap = run.refused ? `\n\nส่งงานได้ ${run.sent} ครั้งตามเพดาน ${getTeam(run.team)?.cap} ที่เหลืออีก ${run.refused} ครั้งส่งไม่ได้ จึงสรุปเท่าที่มี` : "";
  // A person named in the order hears about it from the Entry; the push goes once while unread.
  const tag = parseMentions(run.instruction, project, getTeam(run.team)).people.map((person) => `@${person.name}`).join(" ");
  const done = `สรุปงานจากพนักงาน:\n${lines.join("\n")}${cap}${tag ? `\n\n${tag} ผลพร้อมให้ดูแล้ว` : ""}`;
  finish(run.parent, run.sender, done);
  notifyMentions(run.parent, done, { agent: parent.agent });
}

// Called after every change to any Task: moves delegations on once their children settle.
function advance(parentId: string) {
  const run = runs.get(parentId);
  const parent = getTask(parentId);
  // Stopped or interrupted: nothing is held any more.
  if (!run || !parent || !turnOpen(parent.events)) return void runs.delete(parentId);
  if (!run.started || run.finishing || run.expect.some(({ child, seq }) => !settledAfter(child, seq))) return;
  if (run.round + 1 < run.rounds.length) {
    run.round++;
    return startRound(run);
  }
  run.finishing = true;
  later(parentId, 600, () => finalize(run));
}

function entryTurn(item: QueueItem, task: Task, project: Project): boolean {
  const text = item.text.trim();
  // These the Entry does itself, in the ordinary way (commands, files, context).
  if (/`[^`]+`/.test(text) || /^(?:รัน|run)\s/i.test(text) || /ส่งไฟล์|send_file/.test(text) || /^ย่อ/.test(text) || text === "ทำต่อ" || item.attachments?.length) return false;
  if (/^จำ(?:ว่า)?\s/.test(text)) {
    if (!task.worktree && !workdirReadOnly(task.agent, task.id)) return false;
    finish(task.id, item.member, "จด `MEMORY.md` ตอนนี้ไม่ได้ Workdir อ่านได้อย่างเดียวระหว่างที่มี Turn รันใน Worktree (ADR 0047) ถ้าจะจดให้ทำใน Task ที่ไม่ติ๊ก Worktree");
    return true;
  }
  // One Agent works alone: with no Team there is nobody to delegate to (ADR 0064).
  const team = getTeam(task.team);
  const mentioned = parseMentions(text, project, team);
  const others = (team?.employees ?? []).filter((id) => id !== task.agent);
  const wiki = WIKI.exec(text);
  let targets = mentioned.employees.map((agent) => agent.id).filter((id) => id !== task.agent);
  if (!targets.length) targets = wiki ? others.filter((id) => id === project.wikiWriter) : others;
  if (wiki && project.wikiWriter === task.agent) targets = [];
  if (!targets.length) {
    doWork(item, task, project);
    return true;
  }
  if (!spend(task.id, item.member)) return true;
  // "แตก 8 งาน" asks for more sends than the cap allows, to see the cap hold.
  const total = Number(/(\d+)\s*งาน/.exec(text)?.[1]) || targets.length + (/ตีกลับ|แก้ใหม่/.test(text) ? 1 : 0);
  const rounds: string[][] = [];
  for (let left = total; left > 0; left -= targets.length) rounds.push(targets.slice(0, left));
  const run: Run = { parent: task.id, project: project.id, team: team?.id ?? "", sender: item.member, instruction: text, rounds, round: 0, sent: 0, refused: 0, children: {}, expect: [] };
  runs.set(task.id, run);
  const names = targets.map((id) => getAgent(id)?.name).join(", ");
  append(task.id, { type: "text", text: `รับเรื่องแล้ว จะส่งงานให้ ${names}${mentioned.employees.length ? " ตามที่แท็กไว้" : " ตามคำอธิบายของแต่ละคน"} แล้วรอผลกลับมาสรุป` });
  later(task.id, 800, () => startRound(run));
  return true;
}

function childTurn(item: QueueItem, task: Task, project: Project): boolean {
  withLock(task, () => doWork(item, task, project));
  return true;
}

// --- Ask: a read-only Turn that needs no queue (ADR 0046) ----------------------

const PATHS = /[~.]{0,2}\/?(?:[\w.-]+\/)+[\w.-]*|\.env[\w.]*|[\w-]+\.(?:md|ts|tsx|json|pem|key|yml|yaml|txt)\b/g;

const EVADE = /สมมติ|ถ้าหาก|เล่าอ้อม|ใบ้/;

function searchTasks(question: string, project: Project | undefined, asker: string, agent: Agent) {
  const words = question.split(/\s+/).filter((word) => word.length > 2);
  const pool = project
    ? getTasks().filter((task) => task.project === project.id && !task.parent && !project.closedToAsk.includes(task.id))
    : getTasks().filter((task) => task.agent === agent.id && !task.project && (task.starter === asker || agent.searchOtherTasks));
  return pool.filter((task) => words.some((word) => task.title.toLowerCase().includes(word.toLowerCase()))).slice(0, 3);
}

function askAnswer(question: string, project: Project | undefined, asker: Member, agent: Agent) {
  const tools: string[] = [];
  const text = question.replace(/@\S+/g, "").trim();
  for (const path of text.match(PATHS) ?? []) {
    // The sandbox of an Ask Turn does not open these, whatever the question says.
    const why = project ? pathClosed(project, path) : pathClosed(undefined, path) ?? (!asker.owner && !can(asker, agent.id, "manage") && /^(?:\/|~|\.\.)/.test(path) ? "ขอบเขตการอ่านของคุณคือ Workdir กับ Library (ADR 0059)" : null);
    if (why) return { text: `อ่าน \`${path}\` ไม่ได้: ${why}`, tools, refused: true };
    tools.push(`read_file ${path}`);
  }
  const topic = project?.forbiddenTopics.find((entry) => text.includes(entry));
  if (topic && !EVADE.test(text)) {
    return { text: `ขอไม่ตอบเรื่อง "${topic}" ตามที่ Project ขอไว้\n\nข้อนี้เป็นแค่คำขอที่ส่งให้ LLM ไม่ใช่การกัน ถ้าเป็นความลับจริงให้ย้ายไปไว้ใน path ที่ห้ามอ่าน`, tools, refused: true };
  }
  const parts: string[] = [];
  const page = project?.wiki.find((candidate) => text.toLowerCase().includes(candidate.title.toLowerCase())) ?? project?.wiki.find((candidate) => candidate.text.split(/\s+/).some((word) => word.length > 3 && text.includes(word)));
  if (page) {
    tools.push(`read_wiki ${page.title}`);
    parts.push(`จาก wiki หน้า **${page.title}**: ${page.text.split("\n")[0]}`);
  }
  const found = searchTasks(text, project, asker.id, agent);
  tools.push("search_tasks");
  if (found.length) parts.push(`Task ที่เกี่ยวข้อง: ${found.map((task) => `"${task.title}"`).join(", ")}`);
  if (topic) parts.push(`(หัวข้อ "${topic}" Project ขอให้ไม่ตอบ แต่เป็นแค่คำขอที่ LLM ถูกถามอ้อมจนตอบได้)`);
  if (tools.every((tool) => tool === "search_tasks") && !found.length) parts.push("ไม่พบเรื่องนี้ใน wiki หรือ Task ที่ค้นได้");
  return { text: parts.join("\n\n"), tools, refused: false };
}

export function askBlocked(task: Task, who: Member | undefined): string | null {
  const agent = getAgent(task.agent);
  if (!agent || !who) return "ไม่พบ Agent";
  if (!agent.machine.online) return `${agent.machine.name} ปิดอยู่ Ask ต้องให้ Machine ตอบ`;
  const project = getProject(task.project);
  if (project) return hasRight(project, who, "ask") ? null : "ต้องมีสิทธิ์ Ask ขึ้นไปใน Project";
  if (!can(who, agent.id, "use")) return "ต้องมี Use ที่ Agent นี้";
  const busy = getRuntime().running[agent.id];
  return busy && busy !== task.id ? null : `${agent.name} ว่างอยู่ ส่งข้อความตามปกติได้ Ask ใช้เมื่อ Agent ไม่ว่างเท่านั้น`;
}

// `to`: an employee asked directly by Mention; otherwise the Task's own Agent (the Entry in a Project).
export function askQuestion(taskId: string, text: string, to?: string): string | null {
  const task = getTask(taskId);
  const asker = getCurrentMember();
  if (!task) return "ไม่พบ Task";
  const blocked = askBlocked(task, asker);
  if (blocked) return blocked;
  const project = getProject(task.project);
  const mentioned = parseMentions(text, project, getTeam(rootOf(task).team)).employees[0];
  const target = getAgent(to ?? mentioned?.id ?? task.agent) as Agent;
  const id = nextId("q");
  if (task.title === "Task ใหม่") updateTask(taskId, { title: text.slice(0, 40) });
  append(taskId, { type: "ask", id, text, to: target.id, member: asker.id });
  // Not `later`: Stop ends a Turn, not a question that runs beside it.
  setTimeout(() => {
    if (target.usedToday >= target.budget || (getAgent(target.id)?.usedToday ?? 0) >= target.budget) {
      return append(taskId, { type: "ask_answer", id, text: "Budget ของวันนี้หมดแล้ว ตอบไม่ได้", tools: [], refused: true });
    }
    // The answer uses the answerer's Budget and model (ADR 0046).
    charge(target.id, asker.id, "Task", 12_000);
    append(taskId, { type: "ask_answer", id, ...askAnswer(text, project, asker, target) });
  }, 1400);
  return null;
}

// --- Worktree actions -----------------------------------------------------------

export function treeBusy(taskId: string) {
  return [getTask(taskId), ...descendants(taskId)].some((task) => task && turnOpen(task.events));
}

// Only a Member deletes a worktree, and not while a Turn is writing in it (ADR 0047).
export function removeWorktree(taskId: string): string | null {
  const tree = getWorktree(taskId);
  if (!tree || tree.state === "removed") return "ไม่มีสำเนาให้ลบ";
  if (treeBusy(taskId)) return "ยังมี Turn ทำงานอยู่ในสำเนานี้ หยุดก่อนแล้วค่อยลบ";
  updateWorktree(taskId, { state: "removed" });
  for (const task of [getTask(taskId), ...descendants(taskId)]) if (task) updateTask(task.id, { readOnly: true });
  return null;
}

// A merge is a command like any other, so it asks for Approval unless the Allowlist covers it.
export function askToMerge(taskId: string) {
  const tree = getWorktree(taskId);
  if (tree) sendInProject(taskId, `รัน \`git merge ${tree.branch}\``, "medium");
}

// Notices a finished merge and marks the worktree merged.
function watchMerges() {
  for (const tree of getWorktrees()) {
    if (tree.state !== "open") continue;
    const events = eventsOf(tree.taskId);
    const call = events.find((event) => event.type === "tool_call" && event.command === `git merge ${tree.branch}`);
    if (call?.type === "tool_call" && events.some((event) => event.type === "tool_result" && event.id === call.id && event.ok)) updateWorktree(tree.taskId, { state: "merged" });
  }
}

// --- Plumbing ---------------------------------------------------------------------

setTurnHooks({
  handle(item) {
    const task = getTask(item.taskId);
    const project = getProject(task?.project);
    if (!task || !project) return false;
    return task.parent ? childTurn(item, task, project) : entryTurn(item, task, project);
  },
  side: (taskId) => !!getTask(taskId)?.worktree,
});

let queued = false;
subscribeTasks(() => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    drain();
    for (const id of [...runs.keys()]) advance(id);
    watchMerges();
  }, 30);
});

// A Machine that restarts or a Stop leaves no holder behind: a lock is only held while its Turn is open.

// Rooms to start from, so the Demo Workspace has a Project that already worked once.
function seed() {
  const project = getProject("checkout");
  if (!project) return;
  const parent = createTask({ agent: "reviewer", title: "ปรับหน้าชำระเงินให้กดซ้ำไม่ได้", starter: "m_kai", source: "project", shared: true, project: project.id, team: "checkout-crew" });
  const child = createTask({ agent: "deployer", title: "เช็ก pipeline ของหน้าชำระเงิน", starter: "m_kai", source: "project", shared: true, project: project.id, parent: parent.id });
  append(parent.id, { type: "message", text: "ปรับหน้าชำระเงินให้กดซ้ำไม่ได้ แล้วเช็กว่า pipeline ยังผ่าน", member: "m_kai" }, { type: "turn_start" }, { type: "text", text: "รับเรื่องแล้ว จะส่งงานให้ Deployer เช็ก pipeline" }, { type: "tool_call", id: "d1", command: 'delegate Deployer · "เช็ก pipeline ของหน้าชำระเงิน"' }, { type: "tool_result", id: "d1", ok: true, output: "สร้าง Task ย่อยให้ Deployer (ครั้งที่ 1/5)" });
  append(child.id, { type: "message", text: "เช็ก pipeline ของหน้าชำระเงิน", member: "m_kai" }, { type: "turn_start" }, { type: "text", text: "เสร็จแล้ว: เช็ก pipeline ของหน้าชำระเงิน\n\nผลอยู่ใน checkout หลัก" }, { type: "turn_end" });
  append(parent.id, { type: "text", text: "สรุปงานจากพนักงาน:\n- **Deployer**: เสร็จแล้ว pipeline ผ่านทุกขั้น\n\nแก้ปุ่มแล้ว และปิดปุ่มระหว่างรอผลชำระ" }, { type: "turn_end" });
}
seed();
