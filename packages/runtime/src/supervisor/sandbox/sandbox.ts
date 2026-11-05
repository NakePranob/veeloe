import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import seccompArm64 from "@anthropic-ai/sandbox-runtime/vendor/seccomp/arm64/apply-seccomp" with { type: "file" };
import seccompX64 from "@anthropic-ai/sandbox-runtime/vendor/seccomp/x64/apply-seccomp" with { type: "file" };
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** The Machine cannot sandbox a worker, said so the owner can fix it. The supervisor exits instead of starting one. */
export class SandboxError extends Error {}

/** What one worker may touch (ADR 0008). Only the file rules: the network is the Machine's Egress, the same for every worker. */
export type Policy = Required<Pick<SandboxRuntimeConfig["filesystem"], "denyRead" | "allowRead" | "allowWrite" | "denyWrite">>;

export type Sandbox = {
  /** The argv that runs `command` inside `policy`. */
  wrap(command: string[], policy: Policy): Promise<string[]>;
  /** The Egress every worker's next connection goes by, without starting any worker again. */
  setEgress(domains: string[]): void;
};

/**
 * Secrets no Agent reads, under the home of the user running the Runtime.
 * Fixed in code, one list (design of `sandboxed-commands`). A path that is not
 * there is listed anyway, so it is covered if it appears.
 */
export const SECRET_PATHS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".config/gh",
  ".password-store",
  "Library/Keychains",
  // shell and REPL history
  ".bash_history",
  ".zsh_history",
  ".zsh_sessions",
  ".local/share/fish",
  ".python_history",
  ".node_repl_history",
  ".psql_history",
  ".mysql_history",
  // browser profiles
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Chromium",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc",
  "Library/Application Support/Firefox",
  "Library/Safari",
  "Library/Cookies",
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  ".config/microsoft-edge",
  ".mozilla",
];

/**
 * One worker's rules: it writes its own folder only (its Workdir, its tmp and
 * its tasks.db, whose -wal and -shm sit beside it), and reads nothing of the
 * Runtime's folder but that folder and the binary, nor any secret above.
 * Everything else on the Machine it reads, as a Turn of the Owner may (ADR 0008).
 */
export function policyFor(home: string, agentId: string, userHome: string): Policy {
  const own = join(home, "agents", agentId);
  return {
    denyRead: [home, ...SECRET_PATHS.map((p) => join(userHome, p))].map((path) => ({ path, literal: true as const })),
    allowRead: [own, join(home, "bin")].map((path) => ({ path, literal: true as const })),
    allowWrite: [{ path: own, literal: true as const }],
    denyWrite: [],
  };
}

const INSTALL = "On Debian or Ubuntu: sudo apt install bubblewrap socat ripgrep. On Fedora: sudo dnf install bubblewrap socat ripgrep.";

/** Why this Machine cannot sandbox a worker, or undefined when it can. Pure, so every case is tested without one. */
export function sandboxProblem(platform: NodeJS.Platform, dependencies: { errors: string[] }): string | undefined {
  if (platform === "win32") return "Agents run in a sandbox, which needs macOS or Linux. On Windows, run the Linux build of veeloe inside WSL2.";
  if (platform !== "darwin" && platform !== "linux") return `Agents run in a sandbox, which needs macOS or Linux, not ${platform}.`;
  if (dependencies.errors.length === 0) return undefined;
  return `Agents run in a sandbox, and this Machine is missing: ${dependencies.errors.join(", ")}.${platform === "linux" ? ` ${INSTALL}` : ""}`;
}

/** What to say when the sandbox is there but will not start, as bubblewrap fails where user namespaces are off. */
export function probeProblem(platform: NodeJS.Platform, stderr: string): string {
  const said = stderr.trim() || "no message";
  if (platform !== "linux") return `Agents run in a sandbox, and it would not start: ${said}`;
  return [
    `Agents run in a sandbox, and bubblewrap would not start: ${said}`,
    "If this is Ubuntu 24.04 or later, AppArmor stops unprivileged user namespaces. Allow them with:",
    "  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
    "and to keep it after a restart, put kernel.apparmor_restrict_unprivileged_userns=0 in /etc/sysctl.d/60-veeloe.conf.",
    "veeloe does not run inside Docker yet.",
  ].join("\n");
}

const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

/**
 * The OS sandbox every worker runs in (ADR 0008): Seatbelt on macOS, bubblewrap
 * on Linux, through sandbox-runtime, set up once for the supervisor. Throws
 * SandboxError, before any worker starts, when the Machine cannot do it.
 * There is no way to run a worker outside it, not even for development.
 */
export async function startSandbox({ home, egress }: { home: string; egress: string[] }): Promise<Sandbox & { stop(): Promise<void> }> {
  const problem = sandboxProblem(process.platform, SandboxManager.checkDependencies());
  if (problem) throw new SandboxError(problem);

  // A compiled binary carries no apply-seccomp of its own (task 1.1): it goes on disk, where bubblewrap can run it.
  let seccomp: SandboxRuntimeConfig["seccomp"];
  if (process.platform === "linux") {
    const applyPath = join(home, "bin", "apply-seccomp");
    mkdirSync(join(home, "bin"), { recursive: true, mode: 0o700 });
    await Bun.write(applyPath, Bun.file(process.arch === "arm64" ? seccompArm64 : seccompX64));
    chmodSync(applyPath, 0o700);
    seccomp = { applyPath };
  }

  const config: SandboxRuntimeConfig = {
    network: { allowedDomains: egress, deniedDomains: [] },
    filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    ...(seccomp ? { seccomp } : {}),
  };
  try {
    await SandboxManager.initialize(config);
  } catch (err) {
    throw new SandboxError(probeProblem(process.platform, (err as Error).message));
  }

  const sandbox = {
    /** Its proxies down. sandbox-runtime catches SIGINT and SIGTERM for this and then does not exit, so the caller does. */
    stop: () => SandboxManager.reset(),
    async wrap(command: string[], policy: Policy) {
      const { argv } = await SandboxManager.wrapWithSandboxArgv(command.map(quote).join(" "), undefined, { filesystem: policy });
      return argv;
    },
    setEgress(domains: string[]) {
      const current = SandboxManager.getConfig()!;
      SandboxManager.updateConfig({ ...current, network: { ...current.network, allowedDomains: domains } });
    },
  };

  // sandbox-runtime cannot tell that bubblewrap will fail, so try once before any worker depends on it.
  const probeDir = join(home, "agents", ".probe");
  mkdirSync(probeDir, { recursive: true, mode: 0o700 });
  let said: string;
  try {
    const probe = Bun.spawnSync(await sandbox.wrap(["true"], policyFor(home, ".probe", process.env.HOME ?? "/nonexistent")), { cwd: probeDir, stdout: "ignore", stderr: "pipe" });
    if (probe.exitCode === 0) return sandbox;
    said = probe.stderr.toString();
  } catch (err) {
    said = (err as Error).message;
  }
  // Its proxies would keep the process alive behind the error.
  await SandboxManager.reset();
  throw new SandboxError(probeProblem(process.platform, said));
}
