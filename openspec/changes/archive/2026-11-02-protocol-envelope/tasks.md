## 1. Package and tooling

- [x] 1.1 Restore `packages/protocol` from `33deb1a^` without the `hub-*` messages, `frame.ts` or handshake vectors, add `packages/*` to the root workspaces, and verify `bun install` succeeds and `bun.lock` records `@noble/curves` 2.4.0 and `zod` 4.6.7
- [x] 1.2 Add the package's tests to `bun run test` and its source to `bun run typecheck`, and verify both run the Protocol tests
- [x] 1.3 Verify the restored crypto and base64url tests pass unchanged

## 2. Routing

- [x] 2.1 Add `recipients` to the header and signed part, and enforce exactly one of `to` and `recipients`, with tests for both-present and neither-present being `malformed`
- [x] 2.2 Compare `recipients` with its signed copy element by element, and verify with tests that a changed member and a changed order are both `header-mismatch`
- [x] 2.3 Let the signer accept either route, and verify with a test that absent routing fields stay out of both header and signed part

## 3. Receiver checks

- [x] 3.1 Add the `isForMe` predicate and the `not-addressed` rejection after the header copies check, and verify with tests for the wrong destination and for a recipient list that leaves out the Member
- [x] 3.2 Verify with tests that every rejection reason leaves the sequence counter unchanged, including `not-addressed`
- [x] 3.3 Verify the restored tests for exact bytes, verify-before-parse, replay, gaps and unknown fields pass against the new `verify` signature

## 4. Messages

- [x] 4.1 Add `messages/error.ts` with the code pattern and `params` shape, and verify with tests for a known code, an unfamiliar code, a missing code, a sentence used as a code and a nested parameter
- [x] 4.2 Add `parseMessage` returning `message`, `unknown` or `invalid`, and verify with tests that an unknown type and an invalid `error` both return without throwing

## 5. Published files

- [x] 5.1 Update the vector cases with `recipients` routing, `not-addressed`, both-routes and no-route, regenerate the header schema and vectors, and verify a test fails when either file differs from what the code builds
- [x] 5.2 Verify with a test that the vectors reach every rejection reason, and that the expected set includes `malformed` and `not-addressed`

## 6. Finish

- [x] 6.1 Add the Protocol tests to the CI job in `.github/workflows/ci.yml`, and verify `bun run check` and `bun run test` pass locally with the same commands CI runs
- [x] 6.2 Update `AGENTS.md` where it says the Protocol has no code and what `check` and `test` cover, and verify by reading it against the root `package.json`
- [x] 6.3 Run `openspec validate protocol-envelope --strict` and verify it passes
