import { expect, test } from "bun:test";
import { hubUrl } from "./hub";

test("the Hub is ready and reaches Postgres", async () => {
  const res = await fetch(`${hubUrl}/readyz`);
  expect(res.status).toBe(200);
});
