import { createStore } from "../../../shared/lib";

// How an Agent reaches the web (ADR 0040): a search from the Provider or a Connector, and a
// small web_fetch that runs in the worker, so it is held to the Egress list.

export interface WebSettings {
  search: "off" | "provider" | "connector";
  // The Connector that searches, when search is "connector".
  connector?: string;
  fetch: boolean;
  // web_fetch cuts a page at this many KB.
  maxKb: number;
}

export const DEFAULT_WEB: WebSettings = { search: "off", fetch: false, maxKb: 100 };

// Providers whose own server runs web_search and web_fetch, so Egress need not be opened.
export const PROVIDER_SEARCH = ["anthropic"];

const store = createStore<Record<string, WebSettings>>({ reviewer: { search: "provider", fetch: true, maxKb: 100 } });

export const useWebSettings = store.use;
export const getWebSettings = (agentId: string) => store.get()[agentId] ?? DEFAULT_WEB;

export function setWebSettings(agentId: string, patch: Partial<WebSettings>) {
  store.set((all) => ({ ...all, [agentId]: { ...(all[agentId] ?? DEFAULT_WEB), ...patch } }));
}

export type FetchResult = { ok: true; host: string } | { ok: false; reason: string };

const INTERNAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1)/;

// web_fetch opens only domains in the Agent's Egress, and never an internal address (ADR 0029, 0040).
export function checkFetch(url: string, egress: string[]): FetchResult {
  let host: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "web_fetch เปิดได้แค่ http และ https" };
    host = parsed.hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "URL ไม่ถูกต้อง" };
  }
  if (INTERNAL.test(host)) return { ok: false, reason: "ที่อยู่ภายในเปิดไม่ได้ แม้ Egress จะเปิดทั้งเน็ต" };
  if (egress.includes("*")) return { ok: true, host };
  if (!egress.some((domain) => host === domain || host.endsWith(`.${domain}`))) return { ok: false, reason: `${host} ไม่อยู่ใน Egress ของ Agent นี้` };
  return { ok: true, host };
}
