import { expect, test } from "bun:test";
import { policyFor, probeProblem, sandboxProblem, SECRET_PATHS } from "./sandbox";

const home = "/u/.veeloe";
const user = "/u";
const paths = (entries: (string | { path: string })[]) => entries.map((e) => (typeof e === "string" ? e : e.path));

test("a worker writes its own folder and nothing else", () => {
  const policy = policyFor(home, "a1", user);
  expect(paths(policy.allowWrite)).toEqual(["/u/.veeloe/agents/a1"]);
});

test("a worker reads none of the Runtime's folder but its own folder and the binary", () => {
  const policy = policyFor(home, "a1", user);
  // The whole folder is denied: runtime/, the Machine's key, config.json and every other Agent, ones made later included.
  expect(paths(policy.denyRead)).toContain(home);
  expect(paths(policy.allowRead).sort()).toEqual(["/u/.veeloe/agents/a1", "/u/.veeloe/bin"]);
  for (const allowed of paths(policy.allowRead)) {
    for (const secret of ["runtime", "machine.key", "agents/a2", "config.json"]) expect(`${home}/${secret}`.startsWith(`${allowed}/`)).toBe(false);
  }
});

test("a worker reads no secret on the list, wherever the owner's home is", () => {
  const denied = paths(policyFor(home, "a1", "/home/owner").denyRead);
  for (const secret of [".ssh", ".aws", ".gnupg", ".git-credentials", ".npmrc", ".config/gh", "Library/Keychains", ".zsh_history", ".mozilla"]) {
    expect(SECRET_PATHS).toContain(secret);
    expect(denied).toContain(`/home/owner/${secret}`);
  }
  // Every entry is a path, never a pattern that might match less than it says.
  expect(policyFor(home, "a1", user).denyRead.every((e) => typeof e !== "string" && e.literal)).toBe(true);
});

test("a Machine without a sandbox is told what it lacks and how to get it", () => {
  expect(sandboxProblem("darwin", { errors: [] })).toBeUndefined();
  expect(sandboxProblem("linux", { errors: [] })).toBeUndefined();
  expect(sandboxProblem("win32", { errors: [] })).toContain("WSL2");
  expect(sandboxProblem("freebsd", { errors: [] })).toContain("macOS or Linux");
  const linux = sandboxProblem("linux", { errors: ["bubblewrap (bwrap) not installed", "socat not installed"] })!;
  expect(linux).toContain("bubblewrap (bwrap) not installed");
  expect(linux).toContain("apt install bubblewrap socat ripgrep");
});

test("bubblewrap that will not start says how to allow user namespaces", () => {
  const said = probeProblem("linux", "bwrap: setting up uid map: Permission denied\n");
  expect(said).toContain("setting up uid map: Permission denied");
  expect(said).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
});
