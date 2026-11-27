import { formatList } from "../../../shared/lib";
import type { Item } from "./items";

export type Decision = "approve" | "deny" | "always";
export type Answer = { decision: Decision; allowAlways?: string[]; subdomains?: boolean };
type PromptKey = "authenticate.approve" | "authenticate.always" | "authenticate.domain" | "authenticate.domainAlways";

/**
 * The words the fresh unlock asks with (ADR 0012): a domain's own, the entries going into the Allowlist,
 * or the plain approve. A denial takes no unlock, so it has none. `domain` is set only for a domain Approval.
 */
export function promptFor({
  decision,
  domain,
  agentName,
  allowAlways,
  language,
}: {
  decision: Decision;
  domain?: string;
  agentName: string;
  allowAlways?: readonly string[];
  language: string;
}): { key: PromptKey; values: { name?: string; domain?: string; entries?: string } } | null {
  if (decision === "deny") return null;
  if (domain !== undefined) return { key: decision === "always" ? "authenticate.domainAlways" : "authenticate.domain", values: { domain, name: agentName } };
  if (allowAlways?.length) return { key: "authenticate.always", values: { entries: formatList(allowAlways, language) } };
  return { key: "authenticate.approve", values: { name: agentName } };
}

/**
 * Sends one answer: a yes only behind the fresh unlock (`sign`, keySession.signed), so a phone left open
 * cannot approve; a denial straight away. True once it went out, so the card can say "sent".
 */
export async function respond({
  decision,
  allowAlways,
  subdomains,
  prompt,
  onAnswer,
  sign,
}: {
  decision: Decision;
  allowAlways?: string[];
  /** With \`always\` on a domain: the whole site (issue #80). */
  subdomains?: boolean;
  /** The unlock's words from promptFor, or null for a denial. */
  prompt: string | null;
  onAnswer: (answer: Answer) => string | null;
  sign: (prompt: string, send: () => string | null) => Promise<{ status: string }>;
}): Promise<boolean> {
  if (prompt === null) return !!onAnswer({ decision });
  const answer = { decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }), ...(subdomains === true && { subdomains }) };
  return (await sign(prompt, () => onAnswer(answer))).status === "sent";
}

/**
 * The Approval the composer answers while it steers: kept only while that Approval is still open. Answered
 * on another device or timed out, it is gone, and what was typed stays in the field as an ordinary message.
 */
export function steeringOf(log: readonly Item[], request: string | null): string | null {
  if (request === null) return null;
  return log.some((item) => item.kind === "approval" && item.approval.request === request && item.approval.status === "open") ? request : null;
}

/** "Tell it what to do instead": a refusal that carries the typed words to the Agent in the same Turn. */
export function redirectOf(text: string): { decision: "redirect"; message: string } | null {
  const message = text.trim();
  return message ? { decision: "redirect", message } : null;
}

/**
 * The site a command that only downloads a page opens (`curl`/`wget` with a URL), for the card's
 * one-line summary over the folded command (issue #79). Null for any other command.
 */
export function fetchedHost(command: string): string | null {
  if (!/^\s*(curl|wget)\s/.test(command)) return null;
  const url = command.match(/https?:\/\/[^\s"'|;&)]+/)?.[0];
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// The Runtime's own short list of shared second-level suffixes (egress.rs \`site_of\`), so the card never offers what the Machine refuses.
const SHARED = ["co", "com", "net", "org", "ac", "go", "or", "in", "gov", "edu", "ne", "mi"];

/** The site a host belongs to, for "allow all of *.site" (issue #80): the host less its first label, never a public suffix. */
export function siteOf(host: string): string | null {
  const labels = host.replace(/\.$/, "").toLowerCase().split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  const site = labels.length > 2 ? labels.slice(1) : labels;
  if (site.length === 2 && site[1]?.length === 2 && SHARED.includes(site[0] ?? "")) return null;
  return site.join(".");
}
