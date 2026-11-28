import { expect, test } from "bun:test";
import { fromGroups } from "./access";

const group = (name: string, members: string[], grants: { agent: string; level: "use" | "approve" | "manage" }[]) => ({ name, members, grants });

test("a person gets the highest level of the groups they are in at that Agent, and which group gives it", () => {
  const groups = [group("Sales", ["m_kai"], [{ agent: "pang", level: "use" }]), group("Leads", ["m_kai"], [{ agent: "pang", level: "approve" }]), group("Ops", ["m_lee"], [{ agent: "pang", level: "manage" }])];
  expect(fromGroups(groups, "m_kai", "pang")).toEqual({ level: "approve", group: "Leads" });
  expect(fromGroups(groups, "m_kai", "dev")).toBeNull();
  expect(fromGroups(groups, "m_nobody", "pang")).toBeNull();
});
