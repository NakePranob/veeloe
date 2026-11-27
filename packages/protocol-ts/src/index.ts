export const PROTOCOL_VERSION = 1;

export { createBackoff } from "./backoff";
export { fromBase64url, toBase64url } from "./crypto/base64url";
export { hashBytes } from "./crypto/hash";
export { boxPublic, sealFor } from "./sealed";
export { ProviderAddBodySchema, type ProviderAddBody } from "./messages/provider";
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
  APPROVAL_TIMEOUT_S_DEFAULT,
  APPROVAL_TIMEOUT_S_MAX,
  APPROVAL_TIMEOUT_S_MIN,
  AgentCreateBodySchema,
  AgentDeleteBodySchema,
  AgentIdSchema,
  AgentListBodySchema,
  AgentListedBodySchema,
  AgentRestoreBodySchema,
  AgentTrashEntrySchema,
  AgentUpdateBodySchema,
  AgentUsageBodySchema,
  MachineStatusBodySchema,
  type Agent,
  type AgentCreateBody,
  type AgentDeleteBody,
  type AgentListedBody,
  type AgentRestoreBody,
  type AgentTrashEntry,
  type AgentUpdateBody,
  type AgentUsageBody,
  type MachineStatusBody,
  type ProviderInfo,
} from "./messages/agent";
export {
  TASK_EVENTS_PAGE,
  TaskEventBodySchema,
  TaskEventKind,
  TaskEventSchema,
  TaskEventsBodySchema,
  TaskListBodySchema,
  TaskListedBodySchema,
  TaskMessageBodySchema,
  TaskRenameBodySchema,
  TaskStopBodySchema,
  CardAnswerBodySchema,
  TASK_TITLE_MAX,
  TaskTitled,
  ApprovalSkipped,
  ToolOutputBodySchema,
  TaskSyncBodySchema,
  type TaskEvent,
  type TaskEventBody,
  type TaskEventsBody,
  type TaskListedBody,
  type TaskMessageBody,
  type TaskRenameBody,
  type TaskStopBody,
  type CardAnswerBody,
  type TaskSyncBody,
} from "./messages/task";
export { GIT_REPOS_MAX, GitRepoSchema, GitReposSchema } from "./messages/git-repos";
export { EGRESS_MAX, EgressDomainSchema, EgressSchema, EgressSetBodySchema, type EgressSetBody } from "./messages/egress";
export {
  ALLOWLIST_MAX,
  AllowlistEntrySchema,
  AllowlistSchema,
  isUnsafeCommand,
  matchesAllowlist,
  READ_ONLY_ALLOWLIST,
  builtInCovers,
  entryCovers,
  splitCommand,
  type Allowlist,
} from "./messages/allowlist";
export {
  AllowAlwaysSchema,
  ApprovalAnswerBodySchema,
  ApprovalAnsweredBodySchema,
  ApprovalDecisionSchema,
  ApprovalRequestedBodySchema,
  type ApprovalAnswerBody,
  type ApprovalAnsweredBody,
  type ApprovalDecision,
  type ApprovalRequestedBody,
} from "./messages/approval";
export {
  UsageAgentSchema,
  UsageDaySchema,
  UsageGetBodySchema,
  UsageListedBodySchema,
  type UsageAgent,
  type UsageGetBody,
  type UsageListedBody,
} from "./messages/usage";
export {
  MEMORY_TEXT_MAX,
  MemoryGetBodySchema,
  MemoryGotBodySchema,
  type MemoryGetBody,
  type MemoryGotBody,
} from "./messages/memory";
export {
  CertificateSchema,
  DeviceLinkSchema,
  DeviceRevokeSchema,
  HubCertificatesSchema,
  revokedWith,
  signCertificate,
  verifyCertificate,
  type Certificate,
  type Certified,
  type DeviceLink,
  type DeviceRevoke,
  type HubCertificates,
} from "./messages/certificate";
export {
  buildLinkingLink,
  checkLinkingProof,
  checkLinkRequestProof,
  DeviceHandoffBodySchema,
  DeviceLinkedBodySchema,
  HandoffDataSchema,
  HubLinkRequestSchema,
  LINKING_TTL_SECONDS,
  linkingProof,
  linkRequestProof,
  LinkRequestSchema,
  parseLinkingLink,
  type DeviceHandoffBody,
  type HandoffData,
  type HubLinkRequest,
  type LinkingLink,
  type LinkRequest,
  type ParsedLinkingLink,
} from "./messages/linking";
export {
  IDLE_ITEMS_MAX,
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_MIN_MINUTES,
  ScheduleSchema,
  TRIGGER_TEXT_MAX,
  TRIGGER_GOAL_MAX,
  TriggerListedBodySchema,
  TriggerSchema,
  type IdleProgress,
  type ListedTrigger,
  type Schedule,
  type Trigger,
  type TriggerListedBody,
  type TriggerSetBody,
} from "./messages/trigger";
