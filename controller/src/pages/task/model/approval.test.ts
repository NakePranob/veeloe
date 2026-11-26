import { expect, test } from "bun:test";
import { promptFor, redirectOf, respond, steeringOf } from "./approval";
import type { Item } from "./items";

test("the unlock names what it approves: the domain, the Allowlist entries, or the command", () => {
  expect(promptFor({ decision: "deny", agentName: "Pang", language: "en" })).toBeNull();
  expect(promptFor({ decision: "approve", domain: "example.com", agentName: "Pang", language: "en" })).toEqual({ key: "authenticate.domain", values: { domain: "example.com", name: "Pang" } });
  expect(promptFor({ decision: "always", domain: "example.com", agentName: "Pang", language: "en" })?.key).toBe("authenticate.domainAlways");
  expect(promptFor({ decision: "approve", agentName: "Pang", allowAlways: ["git status", "ls"], language: "en" })).toEqual({ key: "authenticate.always", values: { entries: "git status and ls" } });
  expect(promptFor({ decision: "approve", agentName: "Pang", allowAlways: [], language: "en" })?.key).toBe("authenticate.approve");
});

test("a yes goes out only behind the unlock, and a denial never asks for one", async () => {
  const sent: unknown[] = [];
  const onAnswer = (answer: unknown) => (sent.push(answer), "sig");
  let unlocks = 0;
  const sign = async (_: string, send: () => string | null) => (unlocks++, send() ? { status: "sent" } : { status: "failed" });
  const cancel = async () => ({ status: "cancelled" });

  expect(await respond({ decision: "deny", prompt: null, onAnswer, sign })).toBe(true);
  expect(unlocks).toBe(0);
  expect(await respond({ decision: "approve", allowAlways: ["ls"], prompt: "p", onAnswer, sign })).toBe(true);
  expect(unlocks).toBe(1);
  expect(sent).toEqual([{ decision: "deny" }, { decision: "approve", allowAlways: ["ls"] }]);
  expect(await respond({ decision: "approve", prompt: "p", onAnswer, sign: cancel })).toBe(false);
  expect(sent).toHaveLength(2);
});

const approval = (request: string, status: "open" | "denied" | "expired"): Item => ({ key: request, kind: "approval", approval: { request, status } }) as unknown as Item;

test("steering holds only while its Approval is still open", () => {
  const log = [approval("ap_1", "open"), approval("ap_2", "denied"), approval("ap_3", "expired")];
  expect(steeringOf(log, "ap_1")).toBe("ap_1");
  // Answered elsewhere or timed out: the mode goes, and the words stay in the field.
  expect(steeringOf(log, "ap_2")).toBeNull();
  expect(steeringOf(log, "ap_3")).toBeNull();
  expect(steeringOf(log, "ap_gone")).toBeNull();
  expect(steeringOf(log, null)).toBeNull();
});

test("a redirect is the typed words, and empty words send nothing", () => {
  expect(redirectOf("  run the tests first  ")).toEqual({ decision: "redirect", message: "run the tests first" });
  expect(redirectOf("   ")).toBeNull();
});
