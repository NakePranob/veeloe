import { join } from "node:path";
import { EgressSchema, type AgentListedBody, type EgressSetBody } from "@veeloe/protocol";
import { supervisorDir } from "../config";
import { readJsonFile, writeJsonFile } from "../json-file";
import type { Inbound, Outbox } from "../outbox";

const FILE = "egress.json";

/** The Machine's one Egress (ADR 0008, 0029): no file is an empty list, and an empty list lets no Agent out. */
export function loadEgress(home: string): string[] {
  const parsed = EgressSchema.safeParse(readJsonFile(join(supervisorDir(home), FILE)) ?? []);
  // A file that does not hold a list of domains opens nothing.
  return parsed.success ? parsed.data : [];
}

/**
 * `egress.set`: the whole new list, already checked against the Protocol's
 * schema and signed by a key in trust. Saved in one step, given to the sandbox
 * for every worker's next connection, and answered with `agent.listed`.
 */
export function createEgressSlice({ home, apply, outbox, listed }: { home: string; apply: (domains: string[]) => void; outbox: Outbox; listed: () => Promise<AgentListedBody> }) {
  let current = loadEgress(home);
  apply(current);
  return {
    current: () => current,
    async set(from: Inbound, body: EgressSetBody) {
      current = [...new Set(body.egress)];
      writeJsonFile(join(supervisorDir(home), FILE), current);
      apply(current);
      outbox.toMember(from.member, "agent.listed", await listed());
    },
  };
}
