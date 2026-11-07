import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, ApprovalAnswerBody } from "@veeloe/protocol";
import type { ToWorker } from "../../ipc";
import { createAgentRegistry } from "../agent-registry/registry";
import type { Inbound } from "../outbox";
import { createApprovalsSlice } from "./approvals";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "veeloe-approvals-"));
  const registry = createAgentRegistry(home);
  const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a", allowlist: ["ls"] };
  registry.add(agent);
  const sent: ToWorker[] = [];
  let alive = true;
  const errors: string[] = [];
  let broadcasts = 0;
  const slice = createApprovalsSlice({
    registry,
    workers: { send: (id, message) => (alive && id === "a1" ? (sent.push(message), true) : false) },
    outbox: {
      toMember: () => {},
      error: (to, code) => void errors.push(code),
    },
    members: () => ["m_1", "m_2"],
    broadcast: () => void broadcasts++,
  });
  const answer = (member: string, body: ApprovalAnswerBody, ref = "sig-1", task?: string) => slice.answer({ member, ref, ...(task !== undefined && { task }) } as Inbound, body);
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  return { registry, sent, errors, broadcasts: () => broadcasts, answer, setAlive: (v: boolean) => (alive = v), cleanup };
}

test("an answer reaches the waiting worker with who answered and the envelope ref", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "approve" });
    expect(s.errors).toEqual([]);
    expect(s.sent).toEqual([{ kind: "approval", request: "ap_1", decision: "approve", member: "m_1", ref: "sig-1" }]);
  } finally {
    s.cleanup();
  }
});

test("a redirect carries its message", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "redirect", message: "use ls instead" });
    expect(s.sent).toEqual([{ kind: "approval", request: "ap_1", decision: "redirect", message: "use ls instead", member: "m_1", ref: "sig-1" }]);
  } finally {
    s.cleanup();
  }
});

test("an unknown Agent or a stranger hears agent.unknown, and a dead worker hears agent.unavailable", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "nope", request: "ap_1", decision: "approve" });
    s.answer("m_stranger", { agent: "a1", request: "ap_1", decision: "approve" });
    expect(s.errors).toEqual(["agent.unknown", "agent.unknown"]);
    expect(s.sent).toEqual([]);
    s.setAlive(false);
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "deny" });
    expect(s.errors).toEqual(["agent.unknown", "agent.unknown", "agent.unavailable"]);
  } finally {
    s.cleanup();
  }
});

test("allow-always grows the Allowlist, broadcasts it, and still answers", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "approve", allowAlways: "npm" });
    expect(s.errors).toEqual([]);
    expect(s.registry.get("a1")).toMatchObject({ allowlist: ["ls", "npm"] });
    expect(s.broadcasts()).toBe(1);
    expect(s.sent).toHaveLength(1);
    // Adding it again changes nothing.
    s.answer("m_1", { agent: "a1", request: "ap_2", decision: "approve", allowAlways: "npm" });
    expect(s.registry.get("a1")).toMatchObject({ allowlist: ["ls", "npm"] });
  } finally {
    s.cleanup();
  }
});

test("allow-always from a stranger changes nothing", () => {
  const s = setup();
  try {
    s.answer("m_stranger", { agent: "a1", request: "ap_1", decision: "approve", allowAlways: "npm" });
    expect(s.errors).toEqual(["agent.unknown"]);
    expect(s.registry.get("a1")).toMatchObject({ allowlist: ["ls"] });
    expect(s.sent).toEqual([]);
  } finally {
    s.cleanup();
  }
});

test("the answer carries its Task to the worker, so another Task's wait stays untouched", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "approve" });
    expect(s.sent).toEqual([{ kind: "approval", request: "ap_1", decision: "approve", member: "m_1", ref: "sig-1" }]);
    s.sent.length = 0;
    s.answer("m_1", { agent: "a1", request: "ap_2", decision: "deny" }, "sig-1", "t9");
    expect(s.sent).toEqual([{ kind: "approval", request: "ap_2", decision: "deny", member: "m_1", ref: "sig-1", task: "t9" }]);
  } finally {
    s.cleanup();
  }
});

test("allow-always with several entries adds them all, once each, and still answers", () => {
  const s = setup();
  try {
    s.answer("m_1", { agent: "a1", request: "ap_1", decision: "approve", allowAlways: ["rm -rf dist", "npm run build", "ls"] });
    expect(s.errors).toEqual([]);
    expect(s.registry.get("a1")).toMatchObject({ allowlist: ["ls", "rm -rf dist", "npm run build"] });
    expect(s.broadcasts()).toBe(1);
    expect(s.sent).toHaveLength(1);
  } finally {
    s.cleanup();
  }
});
