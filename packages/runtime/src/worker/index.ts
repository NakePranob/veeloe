import { PROTOCOL_VERSION } from "@veeloe/protocol";

export function runWorker(agentId: string) {
  console.log(`veeloe worker for agent ${agentId}, protocol v${PROTOCOL_VERSION}`);
}
