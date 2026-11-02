## Why

Every later v0.1 change needs messages between Controller, Hub and Runtime that a compromised Hub cannot forge, redirect or replay (ADR 0006, 0019). This is the first change in `docs/roadmap.md`, and the Protocol code was removed in `33deb1a` so the build could restart from the design.

The removed version is a good base but predates three decisions: the recipient list in the header (ADR 0034), errors as codes rather than sentences (ADR 0065), and it never checked that an envelope was meant for the receiver, so a Hub could hand a validly signed envelope to the wrong Runtime.

## What Changes

- Add `packages/protocol`, restored from `33deb1a^` and limited to the envelope: signing, verification, base64url and Ed25519.
- Add a `recipients` list of Member ids to the header and its signed copy, as the routing for messages going to Controllers.
- Add a check that rejects a validly signed envelope not addressed to the receiver.
- Add the `error` message type: a code and parameters, with no human sentence.
- Publish the header's JSON Schema and shared test vectors.
- Wire the package into the root workspace, `bun run check`, `bun run test` and CI.
- Leave out the Hub handshake messages from the old package. They come back with `hub-relay`.

## Capabilities

### New Capabilities
- `protocol-envelope`: the signed envelope carrying every Veeloe message, the checks a receiver makes before trusting it, how unknown content is skipped, and the shape of protocol errors.

### Modified Capabilities

None. `openspec/specs/` is empty.

## Impact

- **New package:** `packages/protocol`, used through the workspace by the Runtime and Controller (ADR 0025).
- **New dependencies:** `@noble/curves` and `zod`, at the versions the old package pinned.
- **Tooling:** root `package.json`, `tsconfig.json` and `.github/workflows/ci.yml`. `AGENTS.md` changes where it says there is no code and what the checks cover.
- **Later changes:** `hub-relay` builds its Go header type and handshake on the published schema and vectors. `controller-foundation` and `machine-pairing` supply durable sequence storage and trusted keys.
