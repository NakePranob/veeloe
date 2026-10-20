import { z } from "zod";

/** The Hub accepted the answer; names the Machine it sees. */
export const HubReadySchema = z.looseObject({
  type: z.literal("hub.ready"),
  machine: z.string().min(1),
});
export type HubReady = z.infer<typeof HubReadySchema>;

/** WebSocket close codes the Hub ends a connection with. */
export const HubCloseCode = {
  /** The answer did not prove a known key. */
  AuthFailed: 4401,
  /** No answer within the handshake timeout. */
  HandshakeTimeout: 4408,
  /** A newer connection with the same key took over. */
  Replaced: 4409,
} as const;
