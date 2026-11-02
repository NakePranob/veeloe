## Context

See `proposal.md` for why. The removed package at `33deb1a^:packages/protocol` already implements exact-bytes signing, header copies, per-sender sequence numbers, loose schemas and generated vectors, with tests. No Runtime, Hub or Controller code exists yet, so nothing consumes this package until later changes.

## Goals / Non-Goals

**Goals:**
- A package the Runtime and Controller can both import, running on Bun, Hermes and the web.
- Tests and vectors for every path that rejects an envelope.

**Non-Goals:**
- Hub handshake (`hub.challenge`, `hub.auth`, `hub.ready`) and Go code: `hub-relay`.
- Durable sequence storage and trusted-key management: `controller-foundation`, `machine-pairing`, `agent-and-task`.
- Message types other than `error`: each arrives with its own change (ADR 0022).
- Unsigned `file.chunk` envelopes (ADR 0050): `attachments`.
- Encryption (ADR 0063): added later, additively.

## Decisions

**Restore the old package and change it, rather than rewrite.** Its behaviour was tested and matches ADR 0019 and 0023. Restore `crypto/`, `envelope/`, `fixtures/` and the vectors build, then drop the `hub-*` messages and their vectors. Writing it again would risk losing rejection cases it already covers.

**`to` and `recipients` are mutually exclusive header fields.** A command names one destination, and an event names the Members who may see it (ADR 0034).
- *Alternative: a required `to` holding a special value such as `members`, next to the list.* That keeps a field with no meaning on half of all messages.
- Zod's refinement enforces "exactly one". The JSON Schema from `z.toJSONSchema` marks both optional, so the vectors carry this rule to other languages.

**Recipients are signed, and order counts.** Comparing the header to the signed copy element by element keeps the check simple, and a sender has no reason to reorder. Before E2E a compromised Hub can still deliver content to anyone, as ADR 0005 and 0034 accept, but it cannot change what the signature says or make a Controller accept a message that leaves out its Member.

**`verify` gains an `isForMe` predicate.** The caller passes `{ isForMe(route): boolean }`: a Runtime answers for the Agents and Machine it hosts, and a Controller answers for its Member. The Protocol cannot know these itself. The new rejection reason is `not-addressed`.

**Check order is: header shape, trusted key, signature, signed part shape, header copies, addressing, sequence.** Sequence stays last so that no rejected envelope moves the counter.
- *Alternative: check addressing first.* It could avoid signature work, but it would answer for unauthenticated content, which ADR 0019 rules out.

**A registry parses verified bodies.** `parseMessage(signed)` returns `message`, `unknown` or `invalid`, the same three outcomes as the old `parseFrame`. It starts with one entry, `error`, in `messages/error.ts` (ADR 0022).

**Error codes are open strings matching `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`.** The schema does not list known codes, because ADR 0023 lets a newer sender add one. `params` is a record of string, number or boolean. A field linking an error to the command it answers is left out until a change needs it, which ADR 0023 allows adding later.

**Dependencies stay pinned exactly**, at the old `@noble/curves` 2.4.0 and `zod` 4.6.7, and are installed with Bun so `bun.lock` records them. Moving to newer versions is a separate decision.

## Risks / Trade-offs

- [A Hub delivers envelopes out of order, so the earlier one is rejected as replayed] → Sequence numbers are per sender and the path is one ordered connection. `hub-relay` must keep per-sender order.
- [A sender's counter resets after reinstalling, so all its messages are rejected] → The signer leaves counter storage to the caller, and its doc comment says the counter must survive restarts. Durable storage is required of the later changes that sign.
- [`MemorySeenSequences` is used in production by mistake, which reopens replay after a restart] → Keep it marked as test and early-development only, and require a durable store in `agent-and-task`.
- [The Hub's Go Ed25519 and noble differ on edge-case signatures] → The Hub verifies only its handshake, not envelopes (ADR 0012). `hub-relay` handles this with its own vectors.
- [Published vectors go stale] → A test rebuilds them and compares bytes, and `UPDATE_FIXTURES=1` regenerates them deliberately.
