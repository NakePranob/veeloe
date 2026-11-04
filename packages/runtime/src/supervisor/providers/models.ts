import { authHeaders, type Provider, type ProviderAuth } from "./store";

export type Model = { id: string; name?: string };

/** Why a Provider could not list its models, as a code the Controller has words for. */
export type ModelsProblem = "provider.rejected" | "provider.unreachable" | "provider.failed";

export type ModelsResult = { ok: true; models: Model[] } | { ok: false; problem: ModelsProblem };

/**
 * The models a Provider offers with this key (ADR 0042): `GET /v1/models`, which
 * Anthropic and the gateways that copy its format all answer.
 *
 * ponytail: the first page only. Follow `has_more` if a Provider lists more than one page.
 */
export async function listModels(provider: Pick<Provider, "url" | "key" | "auth">, { fetchFn = fetch, timeoutMs = 10_000 } = {}): Promise<ModelsResult> {
  let response: Response;
  try {
    response = await fetchFn(`${provider.url}/v1/models?limit=1000`, {
      headers: { ...authHeaders(provider), "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, problem: "provider.unreachable" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, problem: "provider.rejected" };
  if (!response.ok) return { ok: false, problem: "provider.failed" };
  try {
    const { data } = (await response.json()) as { data: { id: unknown; display_name?: unknown; name?: unknown }[] };
    const models = data
      .filter((m) => typeof m.id === "string" && m.id)
      .map((m) => {
        const name = typeof m.display_name === "string" ? m.display_name : typeof m.name === "string" ? m.name : undefined;
        return name ? { id: m.id as string, name } : { id: m.id as string };
      });
    return { ok: true, models };
  } catch {
    return { ok: false, problem: "provider.failed" };
  }
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
