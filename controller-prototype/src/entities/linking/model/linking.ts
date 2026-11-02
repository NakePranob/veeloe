import { createStore } from "../../../shared/lib";

// Linking through email login at the Hub (ADR 0013). The new device logs in, the Hub
// pushes the request to a device the Member already has, both show a code of the new key.
// waiting: the old device has not answered. approved and denied end it.
export type LinkStage = "waiting" | "approved" | "denied";

export interface LinkRequest {
  id: string;
  member: string;
  deviceName: string;
  kind: "phone" | "tablet" | "web";
  // The key the new device made, and the one the old device was shown.
  key: string;
  seenKey: string;
  stage: LinkStage;
  refusal?: string;
  createdAt: number;
}

const requests = createStore<LinkRequest[]>([]);

export const useLinkRequests = requests.use;
export const getLinkRequests = requests.get;

let counter = 0;

export function createLinkRequest(input: Pick<LinkRequest, "member" | "deviceName" | "kind" | "seenKey">, key: string) {
  const request: LinkRequest = { ...input, key, id: `link_${++counter}`, stage: "waiting", createdAt: Date.now() };
  requests.set((all) => [request, ...all]);
  return request;
}

export function patchLinkRequest(id: string, patch: Partial<LinkRequest>) {
  requests.set((all) => all.map((request) => (request.id === id ? { ...request, ...patch } : request)));
}
