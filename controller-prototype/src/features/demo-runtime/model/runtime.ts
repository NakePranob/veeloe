import { allowed, charge, getAgent, getAgents, updateAgent, updateMachine, type UsageSource } from "../../../entities/agent";
import { can, getCurrentMemberId, getMembers } from "../../../entities/member";
import { clearNotifications, pushNotification } from "../../../entities/notification";
import { append, createTask, eventsOf, getTask, getTasks, stateOf, turnOpen, updateTask, type Attachment, type Effort, type TaskSource } from "../../../entities/task";
import { createStore } from "../../../shared/lib";

// The Demo Workspace's stand-in for a Runtime. Nothing leaves the phone (CONTEXT.md), so it
// answers on timers and applies the Runtime's rules: one Turn at a time per Agent with a queue
// (ADR 0011), Allowlist and Approval (ADR 0030), Budget (ADR 0043), restart (ADR 0033).

export interface QueueItem {
  taskId: string;
  seq: number;
  member: string;
  text: string;
  attachments?: Attachment[];
  // A scripted answer, for work that does not come from a person typing.
  reply?: string;
  silent?: boolean;
}

interface RuntimeState {
  // The Task each Agent is working on.
  running: Record<string, string>;
  queues: Record<string, QueueItem[]>;
}

const runtime = createStore<RuntimeState>({ running: { deployer: "deploy", reviewer: "review" }, queues: {} });
export const useRuntime = runtime.use;

const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
const warned = new Set<string>();
// Machines that take no new Turn while they wait to update (ADR 0009, 0033).
const paused = new Set<string>();
let viewing: string | null = null;
let counter = 0;

// Project and Channel Turns are scripted in project.ts and channel.ts, which plug in here.
// `handle` writes a Turn's body itself and answers true; `side` marks a Task whose Turns run
// beside the Agent's other Turn, because they write another place (a Worktree, ADR 0047).
const hooks: { handle: ((item: QueueItem) => boolean)[]; side: ((taskId: string) => boolean)[] } = { handle: [], side: [] };
const sideRunning = new Set<string>();
export function setTurnHooks(next: { handle?: (item: QueueItem) => boolean; side?: (taskId: string) => boolean }) {
  if (next.handle) hooks.handle.push(next.handle);
  if (next.side) hooks.side.push(next.side);
}

// A timed step of a Task's Turn. Stop and restart cancel every step still to come.
export function later(taskId: string, ms: number, run: () => void) {
  timers.set(taskId, [...(timers.get(taskId) ?? []), setTimeout(run, ms)]);
}

function clearTimers(taskId: string) {
  timers.get(taskId)?.forEach(clearTimeout);
  timers.delete(taskId);
}

function setRunning(agentId: string, taskId: string | null) {
  runtime.set((state) => {
    const running = { ...state.running };
    if (taskId) running[agentId] = taskId;
    else delete running[agentId];
    return { ...state, running };
  });
}

function setQueue(agentId: string, change: (items: QueueItem[]) => QueueItem[]) {
  runtime.set((state) => ({ ...state, queues: { ...state.queues, [agentId]: change(state.queues[agentId] ?? []) } }));
}

// Which message this is in its Agent's queue, from 1; 0 when it is not waiting.
export function queuePosition(state: RuntimeState, agentId: string, seq: number, taskId: string) {
  return (state.queues[agentId] ?? []).findIndex((item) => item.taskId === taskId && item.seq === seq) + 1;
}

const USAGE: Record<TaskSource, UsageSource> = { app: "Task", schedule: "Schedule", idle: "Idle Work", watch: "Watch", channel: "Channel", project: "Task" };

function notifyManagers(agentId: string, title: string) {
  for (const member of getMembers()) {
    if (can(member, agentId, "manage")) pushNotification({ kind: "budget", member: member.id, agent: agentId, title, href: `/agents/${agentId}` });
  }
}

// One LLM call. Returns false when the Budget ran out, which ends the Turn like a Stop.
export function spend(taskId: string, member: string, tokens = 40_000) {
  const task = getTask(taskId);
  if (!task) return false;
  charge(task.agent, member, USAGE[task.source], tokens);
  const agent = getAgent(task.agent);
  if (!agent) return false;
  if (agent.usedToday >= agent.budget * 0.8 && !warned.has(agent.id)) {
    warned.add(agent.id);
    notifyManagers(agent.id, `${agent.name} ใช้ Budget ของวันนี้ถึง 80% แล้ว`);
  }
  if (agent.usedToday >= agent.budget) {
    clearTimers(taskId);
    append(taskId, { type: "budget_out" }, { type: "turn_end" });
    notifyManagers(agent.id, `Budget ของ ${agent.name} หมดแล้ว`);
    endTurn(taskId, false);
    return false;
  }
  return true;
}

// `tell`: the Turn's sender hears about it if they are not looking at this Task (ADR 0044).
function endTurn(taskId: string, tell: boolean, member?: string) {
  const task = getTask(taskId);
  if (!task) return;
  clearNotifications(`/tasks/${taskId}`);
  sideRunning.delete(taskId);
  // A Channel's Task pushes nothing but its Approval (ADR 0044).
  if (tell && member && viewing !== taskId && !task.silent && task.source !== "channel") {
    const name = getAgent(task.agent)?.name ?? "Agent";
    pushNotification({ kind: task.source === "app" ? "turn" : task.source === "schedule" ? "schedule" : "background", member, agent: task.agent, title: `${name} ทำเสร็จแล้ว`, href: `/tasks/${taskId}` });
  }
  if (runtime.get().running[task.agent] === taskId) setRunning(task.agent, null);
  pump(task.agent);
}

export function finish(taskId: string, member: string, reply: string) {
  if (!spend(taskId, member)) return;
  append(taskId, { type: "text", text: reply }, { type: "turn_end" });
  endTurn(taskId, true, member);
}

function runTool(taskId: string, member: string, id: string, command: string, delay: number, after: string) {
  later(taskId, delay, () => append(taskId, { type: "tool_call", id, command }));
  later(taskId, delay + 1400, () => {
    append(taskId, { type: "tool_result", id, ok: true, output: `จำลอง: ${command} สำเร็จ` });
    finish(taskId, member, after);
  });
}

const HOW_TO = "นี่คือ **Demo Workspace** ข้อความไม่ได้ส่งไปที่ Machine ไหน ลองสั่งดูได้:\n- `ls` อยู่ใน Allowlist จึงรันได้เลย\n- `npm run deploy:prod` ไม่อยู่ใน Allowlist จึงต้องขอ Approval\n- `ls && rm -rf build` ต้องผ่านทุกท่อน\n- `echo $(whoami)` ต้องขอ Approval เสมอ\n- พิมพ์ “จำว่า ...” เพื่อจดลง Memory\n- พิมพ์ “ส่งไฟล์” เพื่อให้ฉันส่งไฟล์กลับ\n- พิมพ์ “ย่อ” เพื่อดูการย่อ context";

function requestApproval(taskId: string, command: string) {
  const task = getTask(taskId);
  const agent = task && getAgent(task.agent);
  if (!task || !agent) return;
  const id = `a${++counter}`;
  const expiresAt = Date.now() + agent.approvalMinutes * 60_000;
  append(taskId, { type: "text", text: `จะรัน \`${command}\` ซึ่งไม่อยู่ใน Allowlist ขออนุมัติก่อนนะ` }, { type: "approval_request", id, command, reason: "ต้องรันคำสั่งนี้ถึงจะทำงานต่อได้", expiresAt });
  for (const member of getMembers()) {
    if (can(member, agent.id, "approve")) pushNotification({ kind: "approval", member: member.id, agent: agent.id, title: `${agent.name} มี Approval รออยู่`, href: `/tasks/${taskId}` });
  }
  later(taskId, agent.approvalMinutes * 60_000, () => expire(taskId));
}

function expire(taskId: string) {
  append(taskId, { type: "text", text: "Approval หมดเวลา นับว่าปฏิเสธ ยังไม่ได้ทำอะไร" }, { type: "turn_end" });
  endTurn(taskId, false);
}

function runTurn(item: QueueItem) {
  const { taskId, member, text } = item;
  const task = getTask(taskId);
  if (!task) return;
  const agent = getAgent(task.agent);
  if (!agent) return;
  const delay = item.attachments?.length ? 900 : 300;
  later(taskId, delay, () => append(taskId, { type: "turn_start" }));
  later(taskId, delay + 900, () => {
    if (item.reply !== undefined) return finish(taskId, member, item.reply);
    if (hooks.handle.some((handle) => handle(item))) return;
    const command = /`([^`]+)`/.exec(text)?.[1] ?? /^(?:รัน|run)\s+(.+)$/i.exec(text.trim())?.[1];
    if (command) {
      if (!spend(taskId, member)) return;
      if (allowed(command, getAgent(agent.id)?.allowlist ?? [])) runTool(taskId, member, `t${++counter}`, command, 200, `รัน \`${command}\` เสร็จแล้ว`);
      else requestApproval(taskId, command);
      return;
    }
    const note = /^จำ(?:ว่า)?\s+(.+)$/.exec(text.trim())?.[1];
    if (note) {
      // Up to the cap; the Task in progress keeps the Memory it started with (ADR 0036).
      updateAgent(agent.id, { memory: `${getAgent(agent.id)?.memory ?? ""}- ${note}\n`.slice(0, 4000) });
      return runTool(taskId, member, `t${++counter}`, "edit MEMORY.md", 200, "จดลง `MEMORY.md` แล้ว มีผลตั้งแต่ Task ถัดไป");
    }
    if (/ส่งไฟล์|send_file/.test(text)) {
      append(taskId, { type: "file", name: "report.pdf", size: 1_840_000, path: "workdir/report.pdf" });
      return finish(taskId, member, "ส่ง `report.pdf` ให้แล้ว กดการ์ดเพื่อเปิด");
    }
    if (/^ย่อ/.test(text.trim())) {
      append(taskId, { type: "compaction" });
      return finish(taskId, member, "ย่อ context แล้ว คุณยังเห็นประวัติเต็ม ส่วนฉันเห็นแค่บทสรุปกับข้อความใหม่");
    }
    if (item.attachments?.length) return finish(taskId, member, `ได้รับ ${item.attachments.map((file) => `\`${file.name}\``).join(" ")} แล้ว อยู่ที่ \`attachments/${taskId}/\` ใน Workdir`);
    if (text.trim() === "ทำต่อ") return finish(taskId, member, "ดูจากไฟล์แล้ว งานค้างที่ขั้นสุดท้าย ทำต่อจนจบแล้ว");
    finish(taskId, member, HOW_TO);
  });
}

// Starts the next waiting work when the Agent is free, its Machine on and its Budget left.
function pump(agentId: string) {
  const agent = getAgent(agentId);
  const state = runtime.get();
  if (!agent || state.running[agentId] || !agent.machine.online || paused.has(agent.machineId)) return;
  const next = state.queues[agentId]?.[0];
  if (!next) return;
  if (agent.usedToday >= agent.budget) {
    if (eventsOf(next.taskId).at(-1)?.type !== "budget_out") append(next.taskId, { type: "budget_out" });
    return;
  }
  setQueue(agentId, (items) => items.slice(1));
  setRunning(agentId, next.taskId);
  runTurn(next);
}

export function enqueue(agentId: string, item: QueueItem) {
  // A Worktree Turn neither waits for the Agent nor holds it (ADR 0047); with the Machine off it queues as usual.
  if (hooks.side.some((side) => side(item.taskId)) && getAgent(agentId)?.machine.online) {
    sideRunning.add(item.taskId);
    return runTurn(item);
  }
  setQueue(agentId, (items) => [...items, item]);
  pump(agentId);
}

export function sendMessage(taskId: string, text: string, effort: Effort, attachments: Attachment[] = []) {
  const task = getTask(taskId);
  const agent = task && getAgent(task.agent);
  if (!task || !agent) return;
  const member = getCurrentMemberId();
  if (task.title === "Task ใหม่") updateTask(taskId, { title: text.slice(0, 40) || attachments[0]?.name || "Task ใหม่" });
  append(taskId, { type: "message", text, effort, member, attachments: attachments.length ? attachments : undefined });
  const seq = eventsOf(taskId).at(-1)?.seq ?? 0;
  // Machine off: the Hub refuses, so it stays in this device's outbox until the Machine is back (ADR 0005, 0021).
  if (!agent.machine.online) {
    updateTask(taskId, { outbox: [...(task.outbox ?? []), seq] });
    return;
  }
  enqueue(agent.id, { taskId, seq, member, text, attachments });
}

// A Task from the app, empty until the first message.
export function newTask(agentId: string, options: { worktree?: boolean; project?: string } = {}) {
  return createTask({ agent: agentId, title: "Task ใหม่", starter: getCurrentMemberId(), ...options, source: options.project ? "project" : "app" });
}

interface Proactive {
  agent: string;
  title: string;
  message: string;
  member: string;
  source: TaskSource;
  origin?: string;
  reply: string;
  // Nothing to tell: it finishes without a push and stays out of the Inbox (ADR 0027).
  silent?: boolean;
  shared?: boolean;
  project?: string;
  parent?: string;
  readOnly?: boolean;
}

// Work no person typed: a Schedule's round, Idle Work, a Watch or a Channel's message.
export function startProactiveTask({ agent, title, message, member, source, origin, reply, silent, shared, project, parent, readOnly }: Proactive) {
  const task = createTask({ agent, title, starter: member, source, origin, silent, shared: shared ?? source !== "app", project, parent, readOnly });
  append(task.id, { type: "message", text: message, member });
  enqueue(agent, { taskId: task.id, seq: eventsOf(task.id).at(-1)?.seq ?? 0, member, text: message, reply, silent });
  return task;
}

export type Answer = "approve" | "deny" | "steer";

export function answerApproval(taskId: string, approvalId: string, answer: Answer) {
  const request = eventsOf(taskId).find((event) => event.type === "approval_request" && event.id === approvalId);
  if (request?.type !== "approval_request") return;
  const member = getCurrentMemberId();
  clearTimers(taskId);
  clearNotifications(`/tasks/${taskId}`);
  append(taskId, { type: "approval_answer", id: approvalId, approved: answer === "approve", member });
  if (answer === "steer") {
    append(taskId, { type: "turn_end" });
    endTurn(taskId, false);
    return;
  }
  if (answer === "deny") {
    later(taskId, 600, () => finish(taskId, member, "รับทราบ ยังไม่ทำนะ ถ้าอยากให้ทำอย่างอื่นบอกได้เลย"));
    return;
  }
  runTool(taskId, member, approvalId, request.command, 500, "เสร็จแล้ว");
}

// Ends this Turn and every Turn of the Tasks under it, not the ones above (ADR 0017).
export function stopTurn(taskId: string, member = getCurrentMemberId()) {
  const task = getTask(taskId);
  if (!task) return;
  clearTimers(taskId);
  // A Turn still waiting in the queue is stopped too: it never starts (ADR 0017).
  const waiting = !!runtime.get().queues[task.agent]?.some((item) => item.taskId === taskId);
  if (waiting) setQueue(task.agent, (items) => items.filter((item) => item.taskId !== taskId));
  if (waiting || turnOpen(eventsOf(taskId))) append(taskId, { type: "stop", member }, { type: "turn_end" });
  for (const child of getTasks().filter((candidate) => candidate.parent === taskId)) stopTurn(child.id, member);
  endTurn(taskId, false);
}

// Whatever was mid-Turn ends as if stopped, and the queue moves on (ADR 0033).
function interrupt(agentId: string) {
  for (const sideId of sideRunning) {
    if (getTask(sideId)?.agent !== agentId) continue;
    clearTimers(sideId);
    sideRunning.delete(sideId);
    if (turnOpen(eventsOf(sideId))) append(sideId, { type: "interrupted" }, { type: "turn_end" });
  }
  const taskId = runtime.get().running[agentId];
  if (!taskId) return;
  clearTimers(taskId);
  append(taskId, { type: "interrupted" }, { type: "turn_end" });
  clearNotifications(`/tasks/${taskId}`);
  setRunning(agentId, null);
}

export function restartMachine(machineId: string) {
  const agents = getAgents().filter((agent) => agent.machineId === machineId);
  agents.forEach((agent) => interrupt(agent.id));
  agents.forEach((agent) => pump(agent.id));
}

export function setMachineOnline(machineId: string, online: boolean) {
  const agents = getAgents().filter((agent) => agent.machineId === machineId);
  updateMachine(machineId, { online });
  if (!online) {
    agents.forEach((agent) => {
      const taskId = runtime.get().running[agent.id];
      if (taskId) clearTimers(taskId);
      sideRunning.forEach((sideId) => getTask(sideId)?.agent === agent.id && clearTimers(sideId));
    });
    return;
  }
  agents.forEach((agent) => interrupt(agent.id));
  // The outbox goes out now that the Machine is back.
  for (const task of getTasks()) {
    if (!task.outbox?.length || !agents.some((agent) => agent.id === task.agent)) continue;
    for (const seq of task.outbox) {
      const event = task.events.find((candidate) => candidate.seq === seq);
      if (event?.type === "message") enqueue(task.agent, { taskId: task.id, seq, member: event.member ?? task.starter, text: event.text, attachments: event.attachments });
    }
    updateTask(task.id, { outbox: [] });
  }
  agents.forEach((agent) => pump(agent.id));
}

// Budget was raised or the day turned: blocked Tasks say so and the queue moves on.
export function budgetChanged(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent || agent.usedToday >= agent.budget) return;
  if (agent.usedToday < agent.budget * 0.8) warned.delete(agentId);
  for (const task of getTasks()) {
    if (task.agent === agentId && stateOf(task.events) === "budget") append(task.id, { type: "budget_restored" });
  }
  pump(agentId);
}

// So the Turn's push stays quiet while its sender is reading that Task.
export function setViewing(taskId: string | null) {
  viewing = taskId;
  if (taskId && !pendingFor(taskId)) clearNotifications(`/tasks/${taskId}`);
}

const pendingFor = (taskId: string) => stateOf(eventsOf(taskId)) === "waiting";

// The seeded Turns finish on their own, so the Demo Workspace is alive from the start.
later("review", 25_000, () => {
  append("review", { type: "tool_result", id: "t2", ok: true, output: "ไม่พบ index ของ customer_id" });
  finish("review", "m_kai", "ยังไม่มี migration สำหรับ index นี้ ควรเพิ่มก่อน merge PR #42");
});
const seeded = eventsOf("deploy").find((event) => event.type === "approval_request");
if (seeded?.type === "approval_request") later("deploy", seeded.expiresAt - Date.now(), () => expire("deploy"));

export const getRuntime = runtime.get;

// An update found: new work queues as usual but nothing starts until the Machine restarts (ADR 0009, 0033).
export function setMachinePaused(machineId: string, on: boolean) {
  if (on) paused.add(machineId);
  else paused.delete(machineId);
  if (!on) getAgents().filter((agent) => agent.machineId === machineId).forEach((agent) => pump(agent.id));
}

// A removed Member's Turns stop and their queued work is dropped (ADR 0031).
export function dropWorkOf(memberId: string, by = getCurrentMemberId()) {
  for (const taskId of Object.values(runtime.get().running)) {
    const sender = eventsOf(taskId).findLast((event) => event.type === "message");
    if (sender?.type === "message" && sender.member === memberId) stopTurn(taskId, by);
  }
  for (const agentId of Object.keys(runtime.get().queues)) setQueue(agentId, (items) => items.filter((item) => item.member !== memberId));
}
