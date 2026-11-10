import { publicKeyOf, toBase64url, type PairingLink } from "@veeloe/protocol-ts";
import { listDevices } from "../../../entities/device";
import { saveMachine } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { keySession } from "../../../shared/keystore";
import { pairAfterAuthentication, type PairResult } from "./pair";

/** Pairs after a new authentication and keeps the Machine. Null when the owner cancelled that. */
export function usePairMachine() {
  const database = useDatabase();
  return async (link: PairingLink, prompt: string): Promise<PairResult | null> => {
    // The Member's other devices still in use, so the new Machine takes their commands too.
    const own = keySession.secretKey();
    const mine = own ? toBase64url(publicKeyOf(own)) : "";
    const otherKeys = (await listDevices(database)).filter((d) => d.revoked_at === null && d.key !== mine).map((d) => d.key);
    const result = await pairAfterAuthentication((use) => keySession.withFreshAuthentication(prompt, use), { link, otherKeys });
    if (result?.ok) {
      const { id, publicKey, name, hubUrl, workspace, member } = result.machine;
      await saveMachine(database, { id, public_key: publicKey, name, hub_url: hubUrl, workspace_id: workspace, member_id: member, paired_at: Date.now() });
    }
    return result;
  };
}
