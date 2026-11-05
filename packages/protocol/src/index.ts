export const PROTOCOL_VERSION = 1;

export { createBackoff } from "./backoff";
export { fromBase64url, toBase64url } from "./crypto/base64url";
export { generateSecretKey, publicKeyOf, sign, verifySignature } from "./crypto/ed25519";
export { EnvelopeSchema, SignedPartSchema, type Envelope, type Route, type SignedPart } from "./envelope/schema";
export { createSigner, type Outgoing } from "./envelope/sign";
export { parseFrame, type Frame, type KnownMessage as KnownHubFrame } from "./frame";
export { answerChallenge, handshakeBytes, HubAuthSchema, normalizeHubUrl, type HubAuth } from "./messages/hub-auth";
export { HubChallengeSchema, type HubChallenge } from "./messages/hub-challenge";
export { HubErrorSchema, type HubError } from "./messages/hub-error";
export { HubCloseCode, HubReadySchema, type HubReady } from "./messages/hub-ready";
export { MemorySeenSequences, verify, type Rejection, type SeenSequences, type Verified } from "./envelope/verify";
export { parseMessage, type KnownMessage, type ParsedMessage } from "./messages";
export { ErrorBodySchema, type ErrorBody } from "./messages/error";
export { checkPairingProof, pairingProof, PairingClaimBodySchema, PairingDoneBodySchema, type PairingClaimBody, type PairingDoneBody } from "./messages/pairing-claim";
export {
  buildPairingLink,
  buildPairingRequest,
  hubHttpUrl,
  PAIRING_CLOCK_SKEW_SECONDS,
  PAIRING_TTL_SECONDS,
  PairingRequestSchema,
  PairingResponseSchema,
  parsePairingLink,
  type PairingLink,
  type PairingRequest,
  type PairingResponse,
  type ParsedPairingLink,
} from "./messages/pairing-link";
export {
  AgentCreateBodySchema,
  AgentIdSchema,
  AgentListBodySchema,
  AgentListedBodySchema,
  type Agent,
  type AgentCreateBody,
  type AgentListedBody,
  type ProviderInfo,
} from "./messages/agent";
export {
  TASK_EVENTS_PAGE,
  TaskEventBodySchema,
  TaskEventKind,
  TaskEventSchema,
  TaskEventsBodySchema,
  TaskMessageBodySchema,
  TaskSyncBodySchema,
  type TaskEvent,
  type TaskEventBody,
  type TaskEventsBody,
  type TaskMessageBody,
  type TaskSyncBody,
} from "./messages/task";
export { EGRESS_MAX, EgressDomainSchema, EgressSchema, EgressSetBodySchema, type EgressSetBody } from "./messages/egress";
