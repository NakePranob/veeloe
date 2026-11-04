import type { Provider } from "../providers/store";
import { authHeaders } from "../providers/store";

/** What a worker's token stands for: the Provider and model of its Agent, or why there is none. */
export type Route = { provider: Provider; model: string } | { error: "provider.missing" };

/** The header the proxy names its own refusals in, so a worker can tell them from the Provider's. */
export const PROXY_ERROR_HEADER = "x-veeloe-error";

const ALLOWED = new Set(["/v1/messages", "/v1/messages/count_tokens"]);
// What a worker sent that must not reach the Provider: its token, and what fetch sets itself.
const DROPPED = new Set(["host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"]);

function refuse(status: number, code: string) {
  return Response.json({ type: "error", error: { type: "veeloe_error", message: code } }, { status, headers: { [PROXY_ERROR_HEADER]: code } });
}

/**
 * Every request to an LLM goes through here (ADR 0042): a worker sends its
 * token where the SDK puts a key, and this puts the Provider's key in its place,
 * with the Agent's model whatever the request named. Listens on this Machine only.
 *
 * ponytail: tokens are not counted yet. `daily-budget` reads `usage` here (ADR 0043).
 */
export function startLlmProxy({ route, fetchFn = fetch }: { route: (token: string) => Route | undefined; fetchFn?: typeof fetch }) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0, // a long answer streams for minutes
    async fetch(req) {
      const token = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const to = token ? route(token) : undefined;
      if (!to) return refuse(401, "proxy.unknown_worker");
      const { pathname, search } = new URL(req.url);
      if (req.method !== "POST" || !ALLOWED.has(pathname)) return refuse(404, "proxy.not_allowed");
      if ("error" in to) return refuse(424, to.error);

      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return refuse(400, "proxy.bad_request");
      }
      const headers = new Headers();
      for (const [name, value] of req.headers) if (!DROPPED.has(name)) headers.set(name, value);
      for (const [name, value] of Object.entries(authHeaders(to.provider))) headers.set(name, value);

      let upstream: Response;
      try {
        upstream = await fetchFn(`${to.provider.url}${pathname}${search}`, { method: "POST", headers, body: JSON.stringify({ ...body, model: to.model }), signal: req.signal });
      } catch {
        return refuse(502, "provider.unreachable");
      }
      // fetch has already undone any compression, so the length and encoding it was sent with no longer hold.
      const out = new Headers(upstream.headers);
      out.delete("content-encoding");
      out.delete("content-length");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}
