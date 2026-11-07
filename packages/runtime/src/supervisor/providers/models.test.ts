import { expect, test } from "bun:test";
import { listModels } from "./models";
import { FAKE_KEY } from "./fake-provider";

/** A Provider that answers `/v1/models` in pages, as a gateway with many models does. */
function paged(pages: { data: { id: string; display_name?: string }[]; has_more: boolean; last_id?: string }[]) {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      asked.push(url.search);
      const after = url.searchParams.get("after_id");
      const index = after ? pages.findIndex((page) => page.last_id === after) + 1 : 0;
      return Response.json(pages[Math.min(index, pages.length - 1)]);
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, asked, stop: () => server.stop(true) };
}

const provider = (url: string) => ({ url, key: FAKE_KEY, auth: "x-api-key" as const });

test("a Provider that pages its models is followed to the last page", async () => {
  const p = paged([
    { data: [{ id: "model-a", display_name: "Model A" }, { id: "model-b" }], has_more: true, last_id: "model-b" },
    { data: [{ id: "model-c", display_name: "Model C" }], has_more: false },
  ]);
  try {
    const result = await listModels(provider(p.url));
    expect(result).toEqual({ ok: true, models: [{ id: "model-a", name: "Model A" }, { id: "model-b" }, { id: "model-c", name: "Model C" }] });
    expect(p.asked).toHaveLength(2);
    expect(p.asked[1]).toContain("after_id=model-b");
  } finally {
    p.stop();
  }
});

test("a page that names itself as the next one stops the walk instead of looping", async () => {
  const p = paged([{ data: [{ id: "model-a" }], has_more: true, last_id: "cursor-1" }]);
  try {
    const result = await listModels(provider(p.url));
    expect(result).toMatchObject({ ok: true });
    // The first page says `cursor-1`; the next asks from it and is told `cursor-1` again.
    expect(p.asked.length).toBeLessThan(3);
  } finally {
    p.stop();
  }
});
