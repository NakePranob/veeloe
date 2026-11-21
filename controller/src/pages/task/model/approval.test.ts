import { expect, test } from "bun:test";
import { promptFor, respond } from "./approval";

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
