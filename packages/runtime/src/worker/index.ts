import { join } from "node:path";
import type { FromWorker, ToWorker } from "../ipc";
import { anthropicLlm, ipcFetch } from "./adapters/anthropic-llm";
import { bashTool } from "./adapters/bash";
import { openEventStore } from "./adapters/sqlite-store";
import { createAgentCore } from "./core/agent";

/**
 * `veeloe worker --agent <id>`: one Agent's process (ADR 0020), inside the
 * sandbox the supervisor started it in (ADR 0008). It talks to the supervisor
 * over IPC only, its LLM requests included, and ends when the supervisor does.
 */
export function runWorker(agentId: string) {
  const { VEELOE_AGENT_DIR: dir, VEELOE_AGENT_NAME: name } = process.env;
  if (!dir || !name || !process.send) {
    console.error(`veeloe worker ${agentId}: start me from the supervisor`);
    process.exit(2);
  }
  // The sandbox sets a TMPDIR every sandboxed process shares; this Agent's commands get its own (ADR 0008).
  // Caches go there too, since a command may write nowhere else.
  const tmp = join(dir, "tmp");
  Object.assign(process.env, { TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, XDG_CACHE_HOME: join(tmp, "cache"), BUN_INSTALL_CACHE_DIR: join(tmp, "cache/bun"), npm_config_cache: join(tmp, "cache/npm") });

  const send = (message: FromWorker) => process.send!(message);
  const llm = ipcFetch(send);
  const tools = bashTool({ workdir: join(dir, "workdir"), env: process.env });
  const core = createAgentCore({ name, store: openEventStore(join(dir, "tasks.db")), llm: anthropicLlm({ fetch: llm.fetch }), tools, link: { send } });
  process.on("message", (message) => {
    const m = message as ToWorker;
    if (m.kind === "llm.response") llm.receive(m);
    else if (m.kind === "agent") core.rename(m.name);
    else core.receive(m);
  });
  process.on("disconnect", () => process.exit(0));
  send({ kind: "ready" });
}
