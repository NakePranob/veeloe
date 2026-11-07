import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@veeloe/protocol";
import type { ToWorker } from "../../ipc";
import { createAgentRegistry } from "../agent-registry/registry";
import type { Inbound } from "../outbox";
import { createTaskStopSlice } from "./task-stop";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "veeloe-stop-"));
  const registry = createAgentRegistry(home);
  const agent: Agent = { id: "a1", name: "A", provider: "main", model: "model-a" };
  registry.add(agent);
  const sent: ToWorker[] = [];
  const errors: string[] = [];
  let alive = true;
  const slice = createTaskStopSlice({
    registry,
    workers: { send: (id, message) => (alive && id === "a1" ? (sent.push(message), true) : false) },
    outbox: { toMember: () => {}, error: (_to, code) => void errors.push(code) },
    members: () => ["m_1", "m_2"],
  });
  const stop = (member: string, body: { agent: string; id: string }, task = "t1") => slice({ member, ref: "sig-1", task } as Inbound & { task: string }, body);
  return { sent, errors, stop, setAlive: (v: boolean) => (alive = v), cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("a Stop reaches the Agent's worker with the Task and the Member who sent it", () => {
  const s = setup();
  try {
    s.stop("m_1", { agent: "a1", id: "stop-1" }, "task-1");
    expect(s.errors).toEqual([]);
    expect(s.sent).toEqual([{ kind: "stop", task: "task-1", id: "stop-1", member: "m_1", ref: "sig-1" }]);
  } finally {
    s.cleanup();
  }
});

test("an unknown Agent, a stranger, or a dead worker says why nothing stopped", () => {
  const s = setup();
  try {
    s.stop("m_1", { agent: "nope", id: "stop-1" });
    s.stop("m_stranger", { agent: "a1", id: "stop-2" });
    expect(s.errors).toEqual(["agent.unknown", "agent.unknown"]);
    expect(s.sent).toEqual([]);
    s.setAlive(false);
    s.stop("m_1", { agent: "a1", id: "stop-3" });
    expect(s.errors).toEqual(["agent.unknown", "agent.unknown", "agent.unavailable"]);
  } finally {
    s.cleanup();
  }
});
