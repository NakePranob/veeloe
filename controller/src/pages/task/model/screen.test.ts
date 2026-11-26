import { expect, mock, test } from "bun:test";
import * as agentsModel from "../../../entities/agent/model/agents";
import * as allowlist from "../../../entities/agent/model/allowlist";
import * as tasksModel from "../../../entities/task/model/tasks";

// The entities' public APIs also bring their React hooks and expo-sqlite, which Bun cannot load.
// Their whole plain API, as allow-always.test mocks it: Bun keeps one mock per module for the whole run.
mock.module("../../../entities/agent", () => ({ ...agentsModel, ...allowlist }));
mock.module("../../../entities/task", () => tasksModel);
const { agentOf, busyOf, stopStateOf } = await import("./screen");

const pang = agentsModel.deletedAgent("a_1", "m_1", "Pang");

test("a live Agent can be talked to", () => {
  expect(agentOf("a_1", [pang], [], undefined, "deleted")).toEqual({ agent: pang, readOnly: false });
});

test("a deleted Agent is read only, named from the trash or else as deleted, on the trash's Machine or the Task's", () => {
  const trashed = agentOf("a_1", [], [{ id: "a_1", name: "Pang", machine_id: "m_1" }], "m_2", "deleted");
  expect(trashed.readOnly).toBe(true);
  expect(trashed.agent).toMatchObject({ id: "a_1", name: "Pang", machine_id: "m_1" });
  const gone = agentOf("a_1", [], [], "m_2", "deleted");
  expect(gone.readOnly).toBe(true);
  expect(gone.agent).toMatchObject({ id: "a_1", name: "deleted", machine_id: "m_2" });
});

test("busy only while the latest Turn has not ended", () => {
  const row = (seq: number, kind: string) => ({ seq, kind, body: "{}", at: seq });
  expect(busyOf(undefined)).toBe(false);
  expect(busyOf([])).toBe(false);
  expect(busyOf([row(1, "member.message"), row(2, "turn.started")])).toBe(true);
  expect(busyOf([row(1, "member.message"), row(2, "turn.started"), row(3, "turn.ended")])).toBe(false);
  // A stalled Turn is still open: Stop must stay on offer.
  expect(busyOf([row(1, "member.message"), row(2, "turn.started"), row(3, "turn.stalled")])).toBe(true);
  // So is one waiting on an Approval: a message waits for it, and Stop ends it.
  expect(busyOf([row(1, "member.message"), row(2, "turn.started"), row(3, "approval.requested")])).toBe(true);
});

test("the brake stops saying it is stopping when the Machine refuses the Stop or the Turn ends", () => {
  expect(stopStateOf(true, true, null)).toEqual({ asked: true, stopping: true });
  expect(stopStateOf(true, true, "stop.no_turn")).toEqual({ asked: false, stopping: false });
  expect(stopStateOf(true, false, null)).toEqual({ asked: false, stopping: false });
  expect(stopStateOf(false, true, null)).toEqual({ asked: false, stopping: false });
});
