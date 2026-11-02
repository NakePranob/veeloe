export const PROTOCOL_VERSION = 1;

export { fromBase64url, toBase64url } from "./crypto/base64url";
export { generateSecretKey, publicKeyOf, sign, verifySignature } from "./crypto/ed25519";
export { EnvelopeSchema, SignedPartSchema, type Envelope, type Route, type SignedPart } from "./envelope/schema";
export { createSigner, type Outgoing } from "./envelope/sign";
export { MemorySeenSequences, verify, type Rejection, type SeenSequences, type Verified } from "./envelope/verify";
export { parseMessage, type KnownMessage, type ParsedMessage } from "./messages";
export { ErrorBodySchema, type ErrorBody } from "./messages/error";
