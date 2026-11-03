import type { PairingLink } from "@veeloe/protocol";
import { saveMachine } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { keySession } from "../../../shared/keystore";
import { pairAfterAuthentication, type PairResult } from "./pair";

/** Pairs after a new authentication and keeps the Machine. Null when the owner cancelled that. */
export function usePairMachine() {
  const database = useDatabase();
  return async (link: PairingLink, prompt: string): Promise<PairResult | null> => {
    const result = await pairAfterAuthentication((use) => keySession.withFreshAuthentication(prompt, use), { link });
    if (result?.ok) {
      const { id, publicKey, name, hubUrl, workspace, member } = result.machine;
      await saveMachine(database, { id, public_key: publicKey, name, hub_url: hubUrl, workspace_id: workspace, member_id: member, paired_at: Date.now() });
    }
    return result;
  };
}
