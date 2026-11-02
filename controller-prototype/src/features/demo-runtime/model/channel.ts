import { getAgent } from "../../../entities/agent";
import {
  chatNow,
  clock,
  createChannel,
  dayKey,
  getChannel,
  getChannels,
  getPending,
  say,
  sayPending,
  updateChannel,
  updatePending,
  CLAIM_HOURS,
  type Channel,
  type Pending,
} from "../../../entities/channel";
import { can, getCurrentMember, getMembers, thisDevice } from "../../../entities/member";
import { pushNotification } from "../../../entities/notification";
import { getProjects, getTeams, projectAgents } from "../../../entities/project";
import { append, createTask, eventsOf, getTask, subscribeTasks, turnOpen } from "../../../entities/task";
import { enqueue, finish, getRuntime, queuePosition, setTurnHooks, stopTurn, type QueueItem } from "./runtime";

// A Telegram chat, simulated. The real supervisor long-polls the bot's token, which the worker
// never sees, so the chat can ask the Agent anything but cannot learn the token (ADR 0028).

// The Channel is live while the key that signed it is (ADR 0031).
export function channelActive(channel: Channel) {
  const member = getMembers().find((candidate) => candidate.id === channel.signedBy);
  const device = member?.devices.find((candidate) => candidate.id === channel.signedDevice);
  return !channel.stopped && !!member && !member.removed && !!device && !device.revoked;
}

const addressed = (channel: Channel, text: string, replyTo?: number) =>
  // Telegram's privacy mode: a group's bot gets commands, mentions and replies to it. A private chat gets everything.
  channel.kind === "private" || text.startsWith("/") || text.includes(`@${channel.botName}`) || !!(replyTo && channel.chat.find((message) => message.id === replyTo)?.bot);

// Busy for this chat: a Turn is open, a message waits in a queue, or the Machine is off.
function busy(channel: Channel) {
  const agent = getAgent(channel.agent);
  if (!agent?.machine.online) return true;
  const task = channel.taskId ? getTask(channel.taskId) : undefined;
  if (!task) return false;
  const queued = getRuntime().queues[channel.agent]?.some((item) => item.taskId === task.id);
  return turnOpen(task.events) || !!queued || !!task.outbox?.length;
}

// One merged message with each author's name and time, so a waiting Turn reads who said what (ADR 0028).
function dispatch(channel: Channel) {
  const lines = channel.waiting;
  if (!lines.length) return;
  const agent = getAgent(channel.agent);
  if (!agent) return;
  const day = dayKey(chatNow(), channel.cutoff);
  let taskId = channel.taskId;
  if (!taskId || channel.day !== day) {
    // A new day's first message opens its Task; nothing is created for a quiet day.
    taskId = createTask({ agent: channel.agent, title: `${channel.platform} · ${channel.chatName}`, starter: channel.signedBy, source: "channel", shared: true, readOnly: true }).id;
    updateChannel(channel.id, { taskId, day });
  }
  const text = lines
    .map((line) => {
      const quoted = line.replyTo ? channel.chat.find((message) => message.id === line.replyTo) : undefined;
      return `${line.name} (${clock(line.at)}): ${quoted ? `[ตอบ "${quoted.text.slice(0, 40)}"] ` : ""}${line.text}`;
    })
    .join("\n");
  updateChannel(channel.id, { waiting: [] });
  append(taskId, { type: "message", text, member: channel.signedBy });
  const seq = eventsOf(taskId).at(-1)?.seq ?? 0;
  enqueue(channel.agent, { taskId, seq, member: channel.signedBy, text });
  const position = queuePosition(getRuntime(), channel.agent, seq, taskId);
  if (position > 0) say(channel.id, { from: channel.botName, bot: true, text: `อยู่คิวที่ ${position} รอ ${agent.name} ว่างก่อนนะ` });
}

// A person in the chat types. `replyTo`: the message they replied to.
export function postToChat(channelId: string, name: string, text: string, replyTo?: number) {
  const channel = getChannel(channelId);
  if (!channel) return;
  const reach = addressed(channel, text, replyTo);
  say(channelId, { from: name, text, replyTo, delivered: reach });
  if (!reach || !channelActive(channel)) return;
  const command = /^\/(\w+)(?:@(\S+))?/.exec(text.trim());
  if (command?.[2] && command[2] !== channel.botName) return;
  const bot = (reply: string) => say(channelId, { from: channel.botName, bot: true, text: reply });
  if (command) {
    switch (command[1]) {
      case "new":
      case "reset":
        // Only opens a new Task; nothing is deleted (ADR 0028).
        updateChannel(channelId, { taskId: undefined, day: undefined });
        bot("เปิดบทสนทนาใหม่แล้ว ของเดิมยังเก็บไว้");
        return dispatch(getChannel(channelId) as Channel);
      case "stop":
      case "approve":
      case "yes":
        return bot("สั่งหยุดหรืออนุมัติในแชตไม่ได้ ต้องให้ Member ทำในแอป");
      case "claim":
        return bot("แชตนี้ผูกกับ Agent แล้ว");
      default:
        return bot("ไม่รู้จักคำสั่งนี้ มีแค่ /new และ /reset");
    }
  }
  const waitingBefore = channel.waiting.length;
  updateChannel(channelId, { waiting: [...channel.waiting, { at: chatNow(), name, text, replyTo }] });
  const fresh = getChannel(channelId) as Channel;
  if (!busy(fresh)) return dispatch(fresh);
  // Busy: everything that arrives joins one waiting Turn.
  if (!waitingBefore) bot(getAgent(channel.agent)?.machine.online ? "รับไว้แล้ว จะอ่านรวมกันหลังงานปัจจุบันจบ" : "รับไว้แล้ว แต่ Machine ปิดอยู่ จะอ่านเมื่อเครื่องกลับมา");
}

// --- Turns on a Channel's Task ----------------------------------------------

const PATHS = /[~.]{0,2}\/?(?:[\w.-]+\/)+[\w.-]*|\.env[\w.]*|[\w-]+\.(?:md|ts|json|pem|key|yml|txt)\b/g;

// Reading is limited to the Agent's Workdir and a Library; the sandbox decides, not the text (ADR 0028).
function outsideWorkdir(text: string) {
  return (text.match(PATHS) ?? []).find((path) => /^(?:\/|~|\.\.)|(^|\/)(\.env[^/]*|id_rsa[^/]*|[^/]*\.pem|[^/]*\.key)$/.test(path));
}

setTurnHooks({
  handle(item: QueueItem) {
    const task = getTask(item.taskId);
    if (task?.source !== "channel") return false;
    // Commands go the ordinary way, through the Allowlist and an Approval the chat cannot answer.
    if (/`[^`]+`/.test(item.text)) return false;
    const taken = outsideWorkdir(item.text.replace(/^[^:]*\(\d\d:\d\d\):/gm, ""));
    if (taken) {
      finish(task.id, item.member, `อ่าน \`${taken}\` ไม่ได้ครับ ผมอ่านได้แค่ใน Workdir ของผมกับ Library ที่ได้สิทธิ์`);
      return true;
    }
    if (/ส่งไฟล์|send_file|ขอไฟล์/.test(item.text)) {
      append(task.id, { type: "file", name: "price-list.pdf", size: 420_000, path: "workdir/price-list.pdf" });
      finish(task.id, item.member, "ส่ง `price-list.pdf` ให้แล้วครับ");
      return true;
    }
    const lines = item.text.split("\n");
    const names = [...new Set(lines.map((line) => /^([^(:]+) \(/.exec(line)?.[1]).filter(Boolean))];
    finish(task.id, item.member, `รับทราบข้อความของ ${names.join(", ") || "ทุกคน"} แล้วครับ (${lines.length} ข้อความ) นี่คือคำตอบจำลองของ Demo Workspace`);
    return true;
  },
  side: () => false,
});

// --- The chat's view of the Task ------------------------------------------------

const forwarded = new Map<string, number>();

// Carries what the Agent says and does in the Task back into the chat, and enforces the Channel's life.
export function syncChannels() {
  getPending().forEach(expireIfDue);
  for (const channel of getChannels()) {
    if (!channelActive(channel)) {
      if (channel.stopped) continue;
      // The signing key was revoked: the Channel stops at once, even mid-Turn (ADR 0031).
      updateChannel(channel.id, { stopped: true, waiting: [] });
      say(channel.id, { from: "ระบบ", text: "Channel หยุดแล้ว กุญแจที่เซ็นไว้ถูกถอน bot จะไม่ตอบอีก" });
      if (channel.taskId && turnOpen(eventsOf(channel.taskId))) stopTurn(channel.taskId, channel.signedBy);
      continue;
    }
    if (!busy(channel) && channel.waiting.length) dispatch(channel);
    const taskId = channel.taskId;
    if (!taskId) continue;
    const seen = forwarded.get(taskId) ?? 0;
    const events = eventsOf(taskId).filter((event) => event.seq > seen);
    if (!events.length) continue;
    forwarded.set(taskId, events.at(-1)?.seq ?? seen);
    const bot = (text: string, file?: { name: string; size: number }) => say(channel.id, { from: channel.botName, bot: true, text, file });
    const all = eventsOf(taskId);
    for (const event of events) {
      // The words that introduce an Approval name the command, which the chat must not read.
      if (event.type === "text" && all.find((candidate) => candidate.seq === event.seq + 1)?.type === "approval_request") continue;
      // The chat hears the Agent's words and files, and only that someone must approve, never what (ADR 0028).
      if (event.type === "text") bot(event.text.replace(/\*\*|`/g, ""));
      else if (event.type === "file") bot(event.name, { name: event.name, size: event.size });
      else if (event.type === "approval_request") bot("รอทีมงานอนุมัติก่อนนะ");
      else if (event.type === "budget_out") bot("วันนี้ใช้ Budget หมดแล้ว กลับมาตอบได้ตอน 04:00 ครับ");
      else if (event.type === "stop") bot("ทีมงานหยุดงานนี้ไว้");
      else if (event.type === "interrupted") bot("เครื่องเริ่มใหม่กลางคัน ลองส่งอีกครั้งนะ");
    }
  }
}

let queued = false;
subscribeTasks(() => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    syncChannels();
  }, 30);
});
// Revoking a key or switching a Machine on changes no Task, so the Channels also look on a clock.
setInterval(syncChannels, 1000);

// --- Linking from the chat with /claim (ADR 0058) -------------------------------

function expireIfDue(pending: Pending) {
  if (pending.state === "open" && pending.expiresAt && chatNow() > pending.expiresAt) {
    updatePending(pending.id, { state: "expired" });
    sayPending(pending.id, { from: pending.botName, bot: true, text: "ไม่มีใครรับแชตนี้ใน 24 ชั่วโมง bot ออกจากกลุ่มแล้ว" });
  }
}

// A person in a group the bot was added to. Only `/claim` does anything there.
export function postToPending(pendingId: string, name: string, text: string) {
  const pending = getPending().find((item) => item.id === pendingId);
  if (!pending) return;
  expireIfDue(pending);
  const current = getPending().find((item) => item.id === pendingId) as Pending;
  if (current.state !== "open") return sayPending(pendingId, { from: name, text, delivered: false });
  const command = /^\/claim(?:@(\S+))?\s*$/.exec(text.trim());
  sayPending(pendingId, { from: name, text, delivered: !!command });
  // Telegram sends a bare command to one bot only, so a name for another bot is not ours.
  if (!command || (command[1] && command[1] !== pending.botName)) return;
  // One request per chat, and a repeat does nothing.
  if (current.code) return;
  const taken = getProjects().some((project) => projectAgents(project).includes(pending.agent)) || getTeams().some((team) => team.employees.includes(pending.agent));
  const agent = getAgent(pending.agent);
  if (taken) return void sayPending(pendingId, { from: pending.botName, bot: true, text: `${agent?.name ?? "Agent"} ทำงานใน Project อยู่ รับแชตไม่ได้` });
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  updatePending(pendingId, { code, requestedAt: chatNow(), expiresAt: chatNow() + CLAIM_HOURS * 3_600_000 });
  sayPending(pendingId, { from: pending.botName, bot: true, text: `รหัสของแชตนี้คือ ${code}\nคนที่มี Manage ที่ ${agent?.name ?? "Agent"} กรอกรหัสนี้ในแอปเพื่อรับแชต` });
  // Pushed once, to everyone who could take it.
  for (const member of getMembers()) {
    if (can(member, pending.agent, "manage")) pushNotification({ kind: "claim", member: member.id, agent: pending.agent, title: `มีคนขอให้ ${agent?.name ?? "Agent"} รับแชต`, href: `/channels/new?claim=${pendingId}` });
  }
}

// The person with Manage types the code they saw in the chat. Returns why not, or null.
export function checkClaimCode(pendingId: string, code: string): string | null {
  const pending = getPending().find((item) => item.id === pendingId);
  if (!pending) return "ไม่พบคำขอนี้";
  expireIfDue(pending);
  const current = getPending().find((item) => item.id === pendingId) as Pending;
  if (current.state === "claimed") return "แชตนี้มีคนรับไปแล้ว";
  if (current.state === "expired") return "คำขอหมดอายุแล้ว ต้องเชิญ bot เข้ากลุ่มใหม่";
  if (!current.code) return "ยังไม่มีใครพิมพ์ /claim ในแชต";
  if (code.trim() !== current.code) return "รหัสไม่ตรงกับที่ bot แสดงในแชต";
  return null;
}

// After the code matched and the Member signed: the chat becomes a Channel for them.
export function completeClaim(pendingId: string): Channel | null {
  const pending = getPending().find((item) => item.id === pendingId);
  const me = getCurrentMember();
  const device = thisDevice(me);
  if (!pending || !device) return null;
  const channel = createChannel({ agent: pending.agent, chatName: pending.chatName, kind: pending.kind, botName: pending.botName, signedBy: me.id, signedDevice: device.id, via: "claim" });
  updatePending(pendingId, { state: "claimed" });
  say(channel.id, { from: pending.botName, bot: true, text: `รับแชตแล้ว ตอนนี้ผมตอบเมื่อมีคน @${pending.botName} หรือ reply ข้อความของผม` });
  return channel;
}
