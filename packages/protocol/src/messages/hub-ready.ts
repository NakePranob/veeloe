import { z } from "zod";

/** The Hub accepted the answer; names the Machine, or the Member holding the Controller. */
export const HubReadySchema = z
  .looseObject({
    type: z.literal("hub.ready"),
    machine: z.string().min(1).optional(),
    member: z.string().min(1).optional(),
  })
  .refine((ready) => (ready.machine === undefined) !== (ready.member === undefined));
export type HubReady = z.infer<typeof HubReadySchema>;

/** WebSocket close codes the Hub ends a connection with. */
export const HubCloseCode = {
  /** The answer did not prove a known key. */
  AuthFailed: 4401,
  /** This key was revoked: it is not coming back, so wipe and start over. */
  Revoked: 4403,
  /** No answer within the handshake timeout. */
  HandshakeTimeout: 4408,
  /** A newer connection with the same key took over. */
  Replaced: 4409,
  /** The receiver fell too far behind and its queue overflowed. */
  SlowReceiver: 4429,
} as const;
