import type { LlmRequest, LlmResponse } from "../../ipc";
import { usageIn } from "../budget/budget";
import type { Provider } from "../providers/store";
import { upstreamHeaders } from "../providers/presets";

/** What an Agent's requests go to: the Provider and model of that Agent, or why there is none. */
export type Route = { provider: Provider; model: string } | { error: "provider.missing" };

/** The header the supervisor names its own refusals in, so a worker can tell them from the Provider's. */
export const PROXY_ERROR_HEADER = "x-veeloe-error";

const ALLOWED = new Set(["/v1/messages", "/v1/messages/count_tokens"]);
/** The header a worker names the Task of a request in; the supervisor reads it and never sends it on. */
export const TASK_HEADER = "x-veeloe-task";
// What a worker sent that must not reach the Provider: the SDK's placeholder key, what fetch sets itself, and the Runtime's own x-veeloe-* headers.
const DROPPED = new Set(["host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"]);

function refuse(status: number, code: string, headers: Record<string, string> = {}): LlmResponse {
  return { status, headers: { "content-type": "application/json", [PROXY_ERROR_HEADER]: code, ...headers }, body: JSON.stringify({ type: "error", error: { type: "veeloe_error", message: code } }) };
}

/**
 * Every request to an LLM goes through here (ADR 0042). It comes over the IPC
 * of one worker, so the Agent is the one whose worker that is, never what the
 * request says. This puts the Provider's key in and the model the Task is pinned to, and
 * answers once the Provider has sent everything, a stream included: the worker
 * only keeps the finished message. Nothing listens on a port.
 *
 * ponytail: the whole answer in one IPC message. Send `llm.chunk`s when the Controller shows a reply as it is typed.
 */
export function createLlmHandler({
  route,
  fetchFn = fetch,
  allow,
  onUsage,
  log = () => {},
}: {
  route: (agent: string, task: string | undefined) => Route | undefined;
  fetchFn?: typeof fetch;
  /** False when this Agent's Budget is spent: its next answer is refused before the Provider is asked (ADR 0043). */
  allow?: (agent: string) => boolean;
  /** Every answer that reported `usage`, after it was read whole, with the Task it belonged to. */
  onUsage?: (agent: string, task: string | undefined, tokens: number) => void;
  /** A line for the operator when an answer says nothing of `usage`, so a Budget silently stops protecting (ADR 0043). */
  log?: (line: string) => void;
}) {
  return async function handleLlm(agent: string, req: LlmRequest): Promise<LlmResponse> {
    const task = Object.entries(req.headers).find(([name]) => name.toLowerCase() === TASK_HEADER)?.[1];
    const to = route(agent, task);
    if (!to) return refuse(401, "proxy.unknown_worker");
    const { pathname, search } = new URL(req.path, "http://supervisor");
    if (req.method !== "POST" || !ALLOWED.has(pathname)) return refuse(404, "proxy.not_allowed");
    if ("error" in to) return refuse(424, to.error);
    // `count_tokens` costs nothing, so it passes even with the Budget spent and is never counted.
    const counted = pathname === "/v1/messages";
    if (counted && allow && !allow(agent)) return refuse(429, "budget.exhausted", { "x-should-retry": "false" });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return refuse(400, "proxy.bad_request");
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (!DROPPED.has(lower) && !lower.startsWith("x-veeloe-")) headers.set(name, value);
    }
    for (const [name, value] of Object.entries(upstreamHeaders(to.provider, task))) headers.set(name, value);

    try {
      const upstream = await fetchFn(`${to.provider.url}${pathname}${search}`, { method: "POST", headers, body: JSON.stringify({ ...body, model: to.model }) });
      const text = await upstream.text();
      if (counted && onUsage) {
        const tokens = usageIn(text);
        if (tokens !== undefined) {
          try {
            onUsage(agent, task, tokens);
          } catch (err) {
            // The Provider answered and the worker must get it: a tally that cannot be written is reported, not turned into a failure.
            log(`agent ${agent}: could not record ${tokens} tokens (${(err as Error).message})`);
          }
        } else log(`agent ${agent}: the answer reported no usage, so its tokens were not counted`);
      }
      // fetch has already undone any compression, so the length and encoding it was sent with no longer hold.
      const out = Object.fromEntries(upstream.headers);
      delete out["content-encoding"];
      delete out["content-length"];
      return { status: upstream.status, headers: out, body: text };
    } catch {
      return refuse(502, "provider.unreachable");
    }
  };
}
