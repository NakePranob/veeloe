import { describe, expect, test } from "bun:test";
import type { ListedTrigger } from "@veeloe/protocol-ts";
import { withScope } from "./trigger-scope";

const listed: ListedTrigger = { id: "tr_1", kind: "schedule", text: "check", schedule: { daily: { at: "09:00" } }, member: "m", paused: true, suspended: false, allow: ["curl"], lastRunAt: 5 };

describe("withScope", () => {
  test("keeps what the Schedule says and drops what the Machine adds", () => {
    expect(withScope(listed, ["curl", " gh pr list ", "curl", ""])).toEqual({ id: "tr_1", kind: "schedule", text: "check", schedule: { daily: { at: "09:00" } }, allow: ["curl", "gh pr list"] });
  });

  test("an empty scope sends no allow at all", () => {
    expect(withScope(listed, [])).not.toHaveProperty("allow");
  });
});
