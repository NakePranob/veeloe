import { expect, test } from "bun:test";
import { EgressDomainSchema, EgressSchema } from "./egress";

test("a domain or a one-level wildcard is an Egress entry", () => {
  for (const domain of ["github.com", "*.npmjs.org", "registry.npmjs.org", "a-b.co.th"]) expect([domain, EgressDomainSchema.safeParse(domain).success]).toEqual([domain, true]);
});

test("nothing that is not a plain domain name gets in, so localhost and internal addresses stay out by their shape", () => {
  const refused = ["10.0.0.1", "127.0.0.1", "[::1]", "localhost", "https://pypi.org", "pypi.org/simple", "pypi.org:443", "*.*", "*.com", "**.github.com", "a.*.github.com", "GitHub.com", "-a.com", "a..com", " github.com", ""];
  for (const domain of refused) expect([domain, EgressDomainSchema.safeParse(domain).success]).toEqual([domain, false]);
});

test("an Egress holds at most 100 domains", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `d${i}.example.com`);
  expect(EgressSchema.safeParse(many(100)).success).toBe(true);
  expect(EgressSchema.safeParse(many(101)).success).toBe(false);
});
