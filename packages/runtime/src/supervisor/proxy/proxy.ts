import type { LlmRequest, LlmResponse } from "../../ipc";
import type { Provider } from "../providers/store";
import { authHeaders } from "../providers/store";

/** What an Agent's requests go to: the Provider and model of that Agent, or why there is none. */
export type Route = { provider: Provider; model: string } | { error: "provider.missing" };

/** The header the supervisor names its own refusals in, so a worker can tell them from the Provider's. */
export const PROXY_ERROR_HEADER = "x-veeloe-error";

const ALLOWED = new Set(["/v1/messages", "/v1/messages/count_tokens"]);
// What a worker sent that must not reach the Provider: the SDK's placeholder key, and what fetch sets itself.
const DROPPED = new Set(["host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"]);

function refuse(status: number, code: string): LlmResponse {
  return { status, headers: { "content-type": "application/json", [PROXY_ERROR_HEADER]: code }, body: JSON.stringify({ type: "error", error: { type: "veeloe_error", message: code } }) };
}

/**
 * Every request to an LLM goes through here (ADR 0042). It comes over the IPC
 * of one worker, so the Agent is the one whose worker that is, never what the
 * request says. This puts the Provider's key in and the Agent's model, and
 * answers once the Provider has sent everything, a stream included: the worker
 * only keeps the finished message. Nothing listens on a port.
 *
 * ponytail: the whole answer in one IPC message. Send `llm.chunk`s when the Controller shows a reply as it is typed.
 * ponytail: tokens are not counted yet. `daily-budget` reads `usage` here, the one place requests leave (ADR 0043).
 */
export function createLlmHandler({ route, fetchFn = fetch }: { route: (agent: string) => Route | undefined; fetchFn?: typeof fetch }) {
  return async function handleLlm(agent: string, req: LlmRequest): Promise<LlmResponse> {
    const to = route(agent);
    if (!to) return refuse(401, "proxy.unknown_worker");
    const { pathname, search } = new URL(req.path, "http://supervisor");
    if (req.method !== "POST" || !ALLOWED.has(pathname)) return refuse(404, "proxy.not_allowed");
    if ("error" in to) return refuse(424, to.error);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return refuse(400, "proxy.bad_request");
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (!DROPPED.has(name.toLowerCase())) headers.set(name, value);
    for (const [name, value] of Object.entries(authHeaders(to.provider))) headers.set(name, value);

    try {
      const upstream = await fetchFn(`${to.provider.url}${pathname}${search}`, { method: "POST", headers, body: JSON.stringify({ ...body, model: to.model }) });
      const text = await upstream.text();
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
