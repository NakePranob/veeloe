import { join } from "node:path";
import { APPROVAL_TIMEOUT_S_MAX, APPROVAL_TIMEOUT_S_MIN } from "@veeloe/protocol";
import type { FromWorker, ToWorker } from "../ipc";
import { anthropicLlm, ipcFetch } from "./adapters/anthropic-llm";
import { bashTool } from "./adapters/bash";
import { fileTools } from "./adapters/files";
import { openEventStore } from "./adapters/sqlite-store";
import { combineTools } from "./adapters/tools";
import { createAgentCore } from "./core/agent";

/**
 * `veeloe worker --agent <id>`: one Agent's process (ADR 0020), inside the
 * sandbox the supervisor started it in (ADR 0008). It talks to the supervisor
 * over IPC only, its LLM requests included, and ends when the supervisor does.
 */
/** The Allowlist the supervisor packed into the environment; empty when it is missing or broken. */
function readAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

/** The Approval timeout the supervisor packed into the environment, in seconds; an hour when missing or out of range. */
function readTimeoutS(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isInteger(seconds) && seconds >= APPROVAL_TIMEOUT_S_MIN && seconds <= APPROVAL_TIMEOUT_S_MAX ? seconds * 1000 : undefined;
}

export function runWorker(agentId: string) {
  const { VEELOE_AGENT_DIR: dir, VEELOE_AGENT_NAME: name } = process.env;
  if (!dir || !name || !process.send) {
    console.error(`veeloe worker ${agentId}: start me from the supervisor`);
    process.exit(2);
  }
  const allowlist = readAllowlist(process.env.VEELOE_AGENT_ALLOWLIST);
  const approvalTimeoutMs = readTimeoutS(process.env.VEELOE_AGENT_APPROVAL_TIMEOUT_S);
  // The sandbox sets a TMPDIR every sandboxed process shares; this Agent's commands get its own (ADR 0008).
  // Caches go there too, since a command may write nowhere else.
  const tmp = join(dir, "tmp");
  Object.assign(process.env, { TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, XDG_CACHE_HOME: join(tmp, "cache"), BUN_INSTALL_CACHE_DIR: join(tmp, "cache/bun"), npm_config_cache: join(tmp, "cache/npm") });

  const send = (message: FromWorker) => process.send!(message);
  const llm = ipcFetch(send);
  const workdir = join(dir, "workdir");
  const tools = combineTools([bashTool({ workdir, env: process.env }), fileTools({ workdir })]);
  const core = createAgentCore({ name, allowlist, approvalTimeoutMs, store: openEventStore(join(dir, "tasks.db")), llm: anthropicLlm({ fetch: llm.fetch }), tools, link: { send } });
  process.on("message", (message) => {
    const m = message as ToWorker;
    if (m.kind === "llm.response") llm.receive(m);
    else if (m.kind === "agent") {
      core.rename(m.name);
      // Missing from a supervisor older than `approval-and-allowlist`: keep what the environment said (ADR 0023).
      if (m.allowlist !== undefined) core.setAllowlist(m.allowlist);
      if (m.approvalTimeoutS !== undefined) core.setApprovalTimeoutMs(m.approvalTimeoutS * 1000);
    } else core.receive(m);
  });
  process.on("disconnect", () => process.exit(0));
  send({ kind: "ready" });
}
