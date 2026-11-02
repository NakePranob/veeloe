import { expect, test } from "bun:test";
import { checkFetch } from "./web";

test("web_fetch is held to Egress and never reaches an internal address", () => {
  expect(checkFetch("https://github.com/a/b", ["github.com"]).ok).toBe(true);
  expect(checkFetch("https://api.github.com/x", ["github.com"]).ok).toBe(true);
  expect(checkFetch("https://evil.com/?k=secret", ["github.com"]).ok).toBe(false);
  expect(checkFetch("http://192.168.1.5/admin", ["*"]).ok).toBe(false);
  expect(checkFetch("https://example.org", ["*"]).ok).toBe(true);
  expect(checkFetch("notaurl", ["*"]).ok).toBe(false);
});
