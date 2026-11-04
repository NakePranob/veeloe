import { join } from "node:path";
import type { FromWorker, ToWorker } from "../ipc";
import { anthropicLlm } from "./adapters/anthropic-llm";
import { noTools } from "./adapters/no-tools";
import { openEventStore } from "./adapters/sqlite-store";
import { createAgentCore } from "./core/agent";

/**
 * `veeloe worker --agent <id>`: one Agent's process (ADR 0020). The supervisor
 * starts it with its folder, its name and its proxy token, and talks to it over
 * IPC only. It ends when the supervisor does.
 */
export function runWorker(agentId: string) {
  const { VEELOE_AGENT_DIR: dir, VEELOE_AGENT_NAME: name, VEELOE_PROXY_URL: proxyUrl, VEELOE_PROXY_TOKEN: token } = process.env;
  if (!dir || !name || !proxyUrl || !token || !process.send) {
    console.error(`veeloe worker ${agentId}: start me from the supervisor`);
    process.exit(2);
  }
  const send = (message: FromWorker) => process.send!(message);
  const core = createAgentCore({ name, store: openEventStore(join(dir, "tasks.db")), llm: anthropicLlm({ proxyUrl, token }), tools: noTools, link: { send } });
  process.on("message", (message) => core.receive(message as ToWorker));
  process.on("disconnect", () => process.exit(0));
  send({ kind: "ready" });
}
