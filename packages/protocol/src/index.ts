export const PROTOCOL_VERSION = 1;

export { fromBase64url, toBase64url } from "./crypto/base64url";
export { generateSecretKey, publicKeyOf, sign, verifySignature } from "./crypto/ed25519";
export { EnvelopeSchema, SignedPartSchema, type Envelope, type SignedPart } from "./envelope/schema";
export { createSigner, type Outgoing } from "./envelope/sign";
export { MemorySeenSequences, verify, type Rejection, type SeenSequences, type Verified } from "./envelope/verify";
export { parseFrame, type Frame, type KnownMessage } from "./frame";
export { answerChallenge, handshakeBytes, HubAuthSchema, normalizeHubUrl, type HubAuth } from "./messages/hub-auth";
export { HubChallengeSchema, type HubChallenge } from "./messages/hub-challenge";
export { HubCloseCode, HubReadySchema, type HubReady } from "./messages/hub-ready";
