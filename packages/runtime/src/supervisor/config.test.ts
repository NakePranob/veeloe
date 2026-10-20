import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "./config";

const dirs: string[] = [];
function tempHome() {
  const dir = join(mkdtempSync(join(tmpdir(), "veeloe-config-")), "home");
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(join(d, ".."), { recursive: true, force: true })));

test("the Hub URL comes from config.json", () => {
  const home = tempHome();
  loadConfig({ VEELOE_HOME: home, VEELOE_HUB_URL: "wss://unused.example.com" }); // creates the folder
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: "wss://hub.example.com" }));
  expect(loadConfig({ VEELOE_HOME: home })).toEqual({ home, hubUrl: "wss://hub.example.com" });
});

test("VEELOE_HUB_URL overrides config.json", () => {
  const home = tempHome();
  loadConfig({ VEELOE_HOME: home, VEELOE_HUB_URL: "wss://unused.example.com" });
  writeFileSync(join(home, "config.json"), JSON.stringify({ hubUrl: "wss://hub.example.com" }));
  expect(loadConfig({ VEELOE_HOME: home, VEELOE_HUB_URL: "ws://127.0.0.1:18080" }).hubUrl).toBe("ws://127.0.0.1:18080");
});

test("no Hub URL anywhere is an error that names both settings", () => {
  const home = tempHome();
  expect(() => loadConfig({ VEELOE_HOME: home })).toThrow(ConfigError);
  expect(() => loadConfig({ VEELOE_HOME: home })).toThrow(/"hubUrl" in .*config\.json.*VEELOE_HUB_URL/);
});

test("a Hub URL that is not ws:// or wss:// is an error", () => {
  expect(() => loadConfig({ VEELOE_HOME: tempHome(), VEELOE_HUB_URL: "https://hub.example.com" })).toThrow(ConfigError);
});

test("the Runtime's folder is created for its owner only", () => {
  const home = tempHome();
  loadConfig({ VEELOE_HOME: home, VEELOE_HUB_URL: "wss://hub.example.com" });
  expect(statSync(home).mode & 0o777).toBe(0o700);
});

test("an unreadable config.json is an error, not a missing one", () => {
  const home = tempHome();
  loadConfig({ VEELOE_HOME: home, VEELOE_HUB_URL: "wss://hub.example.com" });
  writeFileSync(join(home, "config.json"), "{ not json");
  expect(() => loadConfig({ VEELOE_HOME: home })).toThrow(/cannot read/);
});
