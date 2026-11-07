import { upstreamHeaders } from "./presets";
import type { Provider, ProviderAuth } from "./store";

export type Model = { id: string; name?: string };

/** Why a Provider could not list its models, as a code the Controller has words for. */
export type ModelsProblem = "provider.rejected" | "provider.unreachable" | "provider.failed";

export type ModelsResult = { ok: true; models: Model[] } | { ok: false; problem: ModelsProblem };

/**
 * The models a Provider offers with this key (ADR 0042): `GET /v1/models`, which
 * Anthropic and the gateways that copy its format all answer. A Provider that
 * pages its list is followed to the end, because a model on a later page still
 * has to be selectable.
 */
/** How many pages one list is followed for, so a Provider that never says no cannot loop forever. */
const MAX_PAGES = 10;

export async function listModels(provider: Pick<Provider, "url" | "key" | "auth" | "preset">, { fetchFn = fetch, timeoutMs = 10_000 } = {}): Promise<ModelsResult> {
  const models: Model[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = `limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
    let response: Response;
    try {
      response = await fetchFn(`${provider.url}/v1/models?${query}`, {
        headers: { ...upstreamHeaders(provider), "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, problem: "provider.unreachable" };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, problem: "provider.rejected" };
    if (!response.ok) return { ok: false, problem: "provider.failed" };
    let body: { data?: { id: unknown; display_name?: unknown; name?: unknown }[]; has_more?: unknown; last_id?: unknown };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { ok: false, problem: "provider.failed" };
    }
    for (const m of body.data ?? []) {
      if (typeof m.id !== "string" || !m.id) continue;
      const name = typeof m.display_name === "string" ? m.display_name : typeof m.name === "string" ? m.name : undefined;
      models.push(name ? { id: m.id, name } : { id: m.id });
    }
    // Another page only when the Provider says so and names where it goes on; a stuck cursor stops the walk.
    const next = typeof body.last_id === "string" && body.last_id ? body.last_id : undefined;
    if (body.has_more !== true || !next || next === after) break;
    after = next;
  }
  return { ok: true, models };
}

/** Which header this Provider wants the key in: the first that lists models. */
export async function detectAuth(url: string, key: string, options?: Parameters<typeof listModels>[1]): Promise<{ ok: true; auth: ProviderAuth; models: Model[] } | { ok: false; problem: ModelsProblem }> {
  let last: ModelsProblem = "provider.rejected";
  for (const auth of ["x-api-key", "bearer"] as const) {
    const result = await listModels({ url, key, auth }, options);
    if (result.ok) return { ok: true, auth, models: result.models };
    if (result.problem !== "provider.rejected") return result;
    last = result.problem;
  }
  return { ok: false, problem: last };
}
