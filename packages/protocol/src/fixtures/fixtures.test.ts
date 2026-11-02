import { expect, test } from "bun:test";
import { MemorySeenSequences, verify } from "../envelope/verify";
import { FIXTURES, isForSelf, render } from "./build";

const root = `${import.meta.dir}/../..`;
const update = process.env.UPDATE_FIXTURES === "1";

test.each(Object.entries(FIXTURES))("%s is up to date", async (path, build) => {
  const file = Bun.file(`${root}/${path}`);
  if (update) await Bun.write(file, render(build()));
  expect(await file.text()).toBe(render(build()));
});

test("every envelope vector reaches its expected result", async () => {
  const { trusted, self, vectors } = await Bun.file(`${root}/vectors/envelopes.json`).json();
  const expects = new Set(vectors.map((v: { expect: string }) => v.expect));
  expect([...expects].sort()).toEqual(["bad-signature", "header-mismatch", "malformed", "not-addressed", "ok", "replayed", "untrusted-key"]);
  for (const v of vectors) {
    const seen = new MemorySeenSequences();
    for (const [key, seq] of Object.entries(v.seen)) seen.record(key, seq as number);
    const result = verify(JSON.parse(v.frame), new Set(trusted), isForSelf(self), seen);
    expect([v.name, result.ok ? "ok" : result.reason]).toEqual([v.name, v.expect]);
  }
});
