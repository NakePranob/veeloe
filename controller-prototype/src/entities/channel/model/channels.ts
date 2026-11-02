import { createStore } from "../../../shared/lib";

// A Channel is an outside chat (Telegram here) a Member linked to one Agent and signed. The
// chat below is a stand-in for Telegram; the real Runtime long-polls the bot (ADR 0028).

export interface ChatMessage {
  id: number;
  at: number;
  // A person's name in the chat, or the bot's.
  from: string;
  bot?: boolean;
  text: string;
  file?: { name: string; size: number };
  replyTo?: number;
  // Telegram's privacy mode hands the bot only mentions, replies and commands.
  delivered?: boolean;
}

export interface Waiting {
  at: number;
  name: string;
  text: string;
  replyTo?: number;
}

export interface Channel {
  id: string;
  agent: string;
  platform: "Telegram";
  chatName: string;
  kind: "group" | "private";
  botName: string;
  signedBy: string;
  // The device whose key signed it; revoking that key stops the Channel (ADR 0031).
  signedDevice: string;
  via: "app" | "claim";
  linkedAt: number;
  // HH:MM on the Machine's clock at which a new day's Task begins (ADR 0028).
  cutoff: string;
  // Whether the bot may search Tasks other than this chat's (ADR 0028).
  searchOthers: boolean;
  chat: ChatMessage[];
  day?: string;
  taskId?: string;
  waiting: Waiting[];
  // Set when the key was revoked; the bot says nothing more.
  stopped?: boolean;
}

// A bot added to a group nobody has claimed yet (ADR 0058).
export interface Pending {
  id: string;
  agent: string;
  botName: string;
  chatName: string;
  kind: "group" | "private";
  chat: ChatMessage[];
  code?: string;
  requestedAt?: number;
  expiresAt?: number;
  state: "open" | "claimed" | "expired";
}

export const CLAIM_HOURS = 24;

// The simulated clock: Demo controls move it so a cut-off or an expiry can be reached.
const skew = createStore(0);
export const useChatSkew = skew.use;
export const chatNow = () => Date.now() + skew.get();
export const skipChatTime = (ms: number) => skew.set((value) => value + ms);

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (at: number) => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`;

// The day a message belongs to: the calendar day shifted back by the cut-off (ADR 0028).
export function dayKey(at: number, cutoff: string) {
  const [h, m] = cutoff.split(":").map(Number);
  const d = new Date(at - ((h || 0) * 60 + (m || 0)) * 60_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const validCutoff = (text: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);

const channels = createStore<Channel[]>([
  {
    id: "sales-group",
    agent: "writer",
    platform: "Telegram",
    chatName: "กลุ่มขาย",
    kind: "group",
    botName: "writer_veeloe_bot",
    signedBy: "m_kai",
    signedDevice: "d_kai_phone",
    via: "app",
    linkedAt: Date.now() - 72 * 3_600_000,
    cutoff: "04:00",
    searchOthers: false,
    chat: [],
    waiting: [],
  },
]);
const pending = createStore<Pending[]>([]);

export const useChannels = channels.use;
export const getChannels = channels.get;
export const subscribeChannels = channels.subscribe;
export const usePending = pending.use;
export const getPending = pending.get;

export function useChannel(id: string | undefined) {
  return useChannels().find((channel) => channel.id === id);
}

export function getChannel(id: string) {
  return channels.get().find((channel) => channel.id === id);
}

export function channelsOf(agentId: string) {
  return channels.get().filter((channel) => channel.agent === agentId);
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function createChannel(input: Pick<Channel, "agent" | "chatName" | "kind" | "botName" | "signedBy" | "signedDevice" | "via">) {
  const channel: Channel = { ...input, id: nextId("channel"), platform: "Telegram", linkedAt: Date.now(), cutoff: "04:00", searchOthers: false, chat: [], waiting: [] };
  channels.set((all) => [...all, channel]);
  return channel;
}

export function updateChannel(id: string, patch: Partial<Channel>) {
  channels.set((all) => all.map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)));
}

export function deleteChannel(id: string) {
  channels.set((all) => all.filter((channel) => channel.id !== id));
}

export function say(id: string, message: Omit<ChatMessage, "id" | "at">) {
  const full = { ...message, id: ++counter, at: chatNow() };
  channels.set((all) => all.map((channel) => (channel.id === id ? { ...channel, chat: [...channel.chat, full] } : channel)));
  return full;
}

export function invite(input: Pick<Pending, "agent" | "botName" | "chatName" | "kind">) {
  const item: Pending = {
    ...input,
    id: nextId("claim"),
    state: "open",
    chat: [{ id: ++counter, at: chatNow(), from: input.botName, bot: true, text: "มีคนอยากให้รับแชตนี้ พิมพ์ /claim", delivered: true }],
  };
  pending.set((all) => [...all, item]);
  return item;
}

export function updatePending(id: string, patch: Partial<Pending>) {
  pending.set((all) => all.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

export function sayPending(id: string, message: Omit<ChatMessage, "id" | "at">) {
  const full = { ...message, id: ++counter, at: chatNow() };
  pending.set((all) => all.map((item) => (item.id === id ? { ...item, chat: [...item.chat, full] } : item)));
  return full;
}
