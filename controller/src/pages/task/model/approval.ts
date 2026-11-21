import { formatList } from "../../../shared/lib";

export type Decision = "approve" | "deny" | "always";
export type Answer = { decision: Decision; allowAlways?: string[] };
type PromptKey = "authenticate.approve" | "authenticate.always" | "authenticate.domain" | "authenticate.domainAlways";

/**
 * The words the fresh unlock asks with (ADR 0012): a domain's own, the entries going into the Allowlist,
 * or the plain approve. A denial takes no unlock, so it has none. `domain` is set only for a domain Approval.
 */
export function promptFor({ decision, domain, agentName, allowAlways, language }: { decision: Decision; domain?: string; agentName: string; allowAlways?: readonly string[]; language: string }): { key: PromptKey; values: { name?: string; domain?: string; entries?: string } } | null {
  if (decision === "deny") return null;
  if (domain !== undefined) return { key: decision === "always" ? "authenticate.domainAlways" : "authenticate.domain", values: { domain, name: agentName } };
  if (allowAlways?.length) return { key: "authenticate.always", values: { entries: formatList(allowAlways, language) } };
  return { key: "authenticate.approve", values: { name: agentName } };
}

/**
 * Sends one answer: a yes only behind the fresh unlock (`sign`, keySession.signed), so a phone left open
 * cannot approve; a denial straight away. True once it went out, so the card can say "sent".
 */
export async function respond({ decision, allowAlways, prompt, onAnswer, sign }: {
  decision: Decision;
  allowAlways?: string[];
  /** The unlock's words from promptFor, or null for a denial. */
  prompt: string | null;
  onAnswer: (answer: Answer) => string | null;
  sign: (prompt: string, send: () => string | null) => Promise<{ status: string }>;
}): Promise<boolean> {
  if (prompt === null) return !!onAnswer({ decision });
  const answer = { decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }) };
  return (await sign(prompt, () => onAnswer(answer))).status === "sent";
}
