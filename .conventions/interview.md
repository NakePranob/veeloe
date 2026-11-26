# Interview (2026-11-16)

The request: stop using the go-scaffold CLI and Steiger, and let keel hold the
structure. No business rules were decided here.

- FSD in the Controller: keep the layers and slices; replace Steiger with a keel check. (owner)
- Hub: keep the hexagonal modules; drop go-scaffold (devDependency, config, skill, generated docs). (owner)
- Scope: Controller, Hub and Runtime; the prototype gets no structure check. (owner)
- Structure and probes as drafted in the session, including the new `migration-pairs` rule. (owner: "Yes, go ahead")
- The supervisor stays flat modules (`supervisor-slices` notApplicable); ADR 0022 is corrected rather than the code rewritten. (owner, with the structure)
- Templates are copies in each half's `.conventions/templates/`, so a folder added to a real unit never widens the template. (decided while proving: a probe in `machine` passed when the template pointed at `machine` itself)
- The Runtime's rules sit in `packages/.conventions/`: its workspace builds against `packages/protocol`, which a scratch copy of `packages/runtime` alone lacks. (decided while proving)

## Runtime and protocol (2026-11-16, second round)

The owner said the Runtime and the packages had never been agreed: the first
round's "supervisor stays flat" was read into the structure confirmation, not
asked. Asked now:

- Runtime crates as they are (plugin-api <- core <- worker <- supervisor, the supervisor through `entry` only, files in `src/` and `tests/`), plus: `plugin-api` depends on no other veeloe crate. (owner)
- The supervisor is no longer flat: one module per Hub message in `src/messages/`, CLI commands in `src/cli/`, services stay at `src/`; a message module never imports another. Replaces `supervisor-slices` notApplicable. (owner)
- `packages/protocol` depends on no veeloe crate; `packages/protocol-ts` imports nothing outside its own folder but its declared dependencies. The three sides still agree through `vectors/`. (owner)
- rustfmt: format the Runtime and protocol once in a commit of its own, list it in `.git-blame-ignore-revs`, and `cargo fmt --check` runs in `bun run check` and CI. (owner)

Nothing awaits the owner: there is no QUESTIONS.md.
