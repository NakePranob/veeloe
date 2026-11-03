import { expect, test } from "bun:test";
import { compareLanguages } from "./check-i18n-rules";

test("matching languages have no problems, nested or flat", () => {
  expect(compareLanguages({ a: { b: "ก" }, "hub.machine_offline": "ข" }, { a: { b: "A" }, "hub.machine_offline": "B" })).toEqual([]);
});

test("a key in only one language is named", () => {
  expect(compareLanguages({ shared: "ก" }, { shared: "A", extra: "B" })).toEqual(["extra: missing in th.json"]);
  expect(compareLanguages({ shared: "ก", extra: "ข" }, { shared: "A" })).toEqual(["extra: missing in en.json"]);
});

test("variables that differ are named", () => {
  expect(compareLanguages({ greet: "สวัสดี {{who}}" }, { greet: "Hi {{name}}" })).toEqual(["greet: variables differ, en {name} th {who}"]);
});

test("English plural forms match Thai's one form", () => {
  expect(compareLanguages({ agents_other: "Agent {{count}} ตัว" }, { agents_one: "One Agent", agents_other: "{{count}} Agents" })).toEqual([]);
});

test("a plural missing altogether is still missing", () => {
  expect(compareLanguages({}, { agents_one: "One Agent", agents_other: "{{count}} Agents" })).toEqual(["agents: missing in th.json"]);
});
