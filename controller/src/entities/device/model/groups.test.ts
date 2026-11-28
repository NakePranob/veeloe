import { expect, test } from "bun:test";
import { groupBodies, mergeGroups } from "./devices";

const row = (machine: string, version: number, members: string[], grants: object[]) => ({
  id: "g_sales",
  machine_id: machine,
  name: `Sales v${version}`,
  version,
  members: JSON.stringify(members),
  admins: "[]",
  grants: JSON.stringify(grants),
});

test("a group takes its people from the newest copy and its Grants from every Machine's", () => {
  const [group] = mergeGroups([row("mac-a", 2, ["m_kai"], [{ agent: "pang", level: "use" }]), row("mac-b", 3, ["m_kai", "m_lee"], [{ agent: "dev", level: "manage" }])]);
  expect(group).toEqual({
    id: "g_sales",
    name: "Sales v3",
    version: 3,
    members: ["m_kai", "m_lee"],
    admins: [],
    grants: [
      { machine: "mac-a", agent: "pang", level: "use" },
      { machine: "mac-b", agent: "dev", level: "manage" },
    ],
  });
});

test("a change goes to every Machine at the next version, each with only its own Agents' Grants", () => {
  const [group] = mergeGroups([row("mac-a", 2, ["m_kai"], [{ agent: "pang", level: "use" }])]);
  if (!group) throw new Error("no group");
  expect(groupBodies(group, [{ id: "mac-a" }, { id: "mac-b" }])).toEqual([
    { machine: "mac-a", body: { id: "g_sales", name: "Sales v2", version: 3, members: ["m_kai"], admins: [], grants: [{ agent: "pang", level: "use" }] } },
    { machine: "mac-b", body: { id: "g_sales", name: "Sales v2", version: 3, members: ["m_kai"], admins: [], grants: [] } },
  ]);
});
