# Agent Guidance: veeloe

This is Veeloe (`veeloe` on GitHub), under AGPL-3.0 (`LICENSE`). The design is
here: the Runtime is being built in `packages/runtime`, the Protocol in
`packages/protocol`, the Hub in `hub/` and the Controller in `controller/`, and `controller-prototype/` is a throwaway UI prototype on
Demo data. It is **public** — everything pushed here, a commit message or a PR
description included, is public the moment it lands. Never commit a secret: the Runtime release signing
key, push and Expo credentials, billing keys and the hosted Hub's env stay in
GitHub environments or the host, never in git.

`CONTEXT.md` is the glossary — use its terms. `docs/adr/` holds the
architecture decisions: do not contradict one; if a change has to, say so and
change the ADR in the same commit. `openspec/` holds the specs and changes,
versioned with the code; it starts empty until the build restarts.
GitHub Issues track the work of each version (ADR 0048 sets what each version
holds): open the next change from an issue, and close the issue in the commit
that archives it.

GitHub Releases are for the Runtime only — its updater takes the latest
release as its own (ADR 0009, 0025). The Hub ships as an image on GHCR, the
Controller through EAS.

Outside contributors sign the CLA (CLA Assistant) on their first PR. Do not
merge an outside contribution until the CLA check is green: relicensing and
the App Store build both depend on it (ADR 0016).

## Checks

After `bun install` at the root:

```bash
bun run check
bun run test
```

`check` runs the type check and Steiger on the Controller and its prototype
(ADR 0022), checks that the Controller's Thai and English words match
(ADR 0065), runs the Rust Runtime's `cargo test --workspace`, checks the Protocol
against its vectors on both sides (`check:protocol`: Rust, TypeScript fixtures
and the Hub's copy) and runs `go-scaffold check` on the Hub. `test` runs the
unit tests of `packages/protocol-ts`, the Controller and its prototype; the Rust
crates are tested by `check`, one test at a time (`--test-threads=1`): they start
real supervisor, Hub and worker processes, and parallel runs flaked on timing.
CI runs both, plus `go test -race ./...` in `hub/` and `bun run test:e2e`, which
sends signed envelopes through a real relay, runs the compiled `veeloe` against a
stand-in Provider, and needs Go. `veeloe` runs every Agent's worker in the OS
sandbox (ADR 0008): nothing to install on macOS, and on Linux it needs
`bubblewrap` and `ripgrep`, with unprivileged user namespaces allowed. On
Ubuntu 24.04 install the bwrap-only AppArmor profile
(`/usr/share/apparmor/extra-profiles/bwrap-userns-restrict`) instead of turning
the protection off for the whole machine
(`kernel.apparmor_restrict_unprivileged_userns=0`), for `test:e2e` and for the
Runtime's own binary tests in `check`. Its
sandbox e2e also reaches `example.com`, so it needs the internet. The e2e's Pairing test also
needs a migrated Postgres in `TEST_DB_DSN`, and skips without one unless
`REQUIRE_TEST_DB` is set, as it is in CI.

Write tests where there is a rule or a security check, not for coverage
(ADR 0022).

## Local stack

`bun run dev` brings up what the app needs on this machine, each part logged in
`.dev/` (gitignored): Postgres (`docker compose`), the Hub API on `:8080`, the
Rust Runtime for `VEELOE_HOME` (default `~/.veeloe`) and Metro on `:8081`.

```bash
bun run dev            # up; a part already listening is left alone
bun run dev:status     # what is up, and on which port
bun run dev:pair       # `veeloe pair`, for a Controller that is not paired yet
bun run dev:link       # put `veeloe` on PATH (`~/.local/bin`) pointing at the dev build
bun run dev:unpair     # `veeloe unpair`, to pair this Machine from scratch again
bun run dev:reset-sim  # wipe the simulator app's database (backup in .dev/backup/), then re-pair
bun run dev:restart    # restart the Runtime (e.g. after pairing rotated the Machine key)
bun run dev:seed       # one Agent (qa-memory / Pang) with a MEMORY.md to look at
bun run dev:down       # stop the three processes and Postgres
bun run dev:ios        # e2e/ios-flow-harness.ts serve: temp home + fake Provider
```

`dev` needs `hub/.env` and a migrated database (`make migrate-up` in `hub/`,
once). `dev:pair` runs in the foreground and prints the `veeloe://pair` link;
a Machine that is already paired says so instead, which is what `veeloe unpair`
is for. `dev:seed` writes `agents.json` and `agents/<id>/workdir/MEMORY.md`, so
the Controller's Memory row has something to show without a Task.

## Git hooks

Hooks live in `.githooks/`, not `.git/hooks/`, so they are versioned. Once per
clone:

```bash
git config core.hooksPath .githooks
```

`.githooks/commit-msg` refuses a Thai subject line. Fix the message rather than
passing `--no-verify`.

## Git conventions

Use Conventional Commit subjects with the Emoji after the type separator:

`<type>(optional-scope): <emoji> <description>`

For example: `feat: ✨ add login form`. Do not put the Emoji before the type.

| Type | Emoji | |
|---|---|---|
| `feat` | ✨ | new behaviour (💄 when it is only looks) |
| `fix` | 🐛 | |
| `docs` | 📝 | docs and specs (🔥 when dropping one) |
| `refactor` | ♻️ | |
| `chore` | 🛠 | tooling, skills, config |
| `revert` | ⏪ | |

The subject is **English** — `.githooks/commit-msg` refuses a Thai one, the
same rule `.claude/hooks/pr-title-english.py` enforces on a PR title. Write it
as what the user now gets, not the files touched: `feat: ✨ let users reset
their password by email`, not `feat: ✨ update auth.ts`. The body is free to be
Thai, and to quote the Thai copy the change is about. A body usually goes:

- a bullet per thing that changed (`ทำตาม change <name>:` first when it follows
  an OpenSpec change)
- a short paragraph on a trade-off or what was left out, and why
- what was checked: tests that pass, and what was tried in the real app

A commit that finishes an issue ends its body with `Closes #12` (one line per
issue), so pushing it to `develop`, the default branch, closes the issue.

## Commits on develop (v0.1)

Until v0.1 ships, the maintainer commits straight to `develop`: no branch, no
PR. Run `bun run check` before pushing, because nothing on GitHub gates the push — CI runs after it
lands, and a red run is fixed with the next commit. The `develop` ruleset only
refuses force-pushes and deleting the branch. When v0.1 ships, the PR rule and
the required `english` check go back on `develop`, and work moves to branches
again.

## Pull requests

Outside contributors still open a PR into `develop`, and `main` is promoted
from `develop` through a PR, so nothing targets `main` directly — dependabot
included (`target-branch: develop`). `develop` merges by squash only; check
that the `english` check (`.github/workflows/pr-title.yml`) is green before
merging, because the ruleset no longer requires it during v0.1. `main` is
guarded by a ruleset (no direct push, no force-push, no deletion) and merges by
merge commit only, so promoting `develop` never forks the two histories. No
approval is required.

Title in English, same shape as a commit subject, with no issue number: the
squash merge appends the PR number, so `(#12)` in the title would leave two
numbers in the subject. The issue goes in the description instead — its first
line is `Closes #12` (one line per issue), which closes it when the PR is
squashed into `develop`, the default branch. The description is Thai — it is
what the team reads.

The two languages in one command is what makes this easy to get wrong: writing
a long Thai description pulls the title along with it. `gh pr create` and
`gh pr edit` are refused when `--title` is Thai —
`.claude/hooks/pr-title-english.py`, wired up in `.claude/settings.json`, so
Claude Code enforces it and Codex does not. `.github/workflows/pr-title.yml`
is the backstop for every other tool — Codex, `gh` by hand, a title edited in
the browser — and it matters because a squash into `develop` takes the PR
title as the commit subject. Reuse the branch's commit subject as the title;
it is already written to this rule.

Put in the description whatever the diff cannot say for itself. Usually that
is why it was done this way, what is left undone and what blocks it, and what
was checked versus what a reviewer still has to click. A PR closing an issue
answers its acceptance criteria one by one; plenty of PRs have no issue at
all. The usual sections, each bullet led by a **bold label**:

- `## ทำไม` (or `## ปัญหา` / `## สาเหตุ` for a fix)
- `## ทำอะไร`
- `## ตรวจแล้ว`
- `## ยังต้องกดดู` — `- [ ]` steps a reviewer clicks through
- `## ข้อจำกัด` — ends with `**ไม่มี issue**` when there is none

## Agent skills

### Issue tracker

GitHub Issues on `NakePranob/veeloe`, worked with `gh`; `/to-tickets` publishes
tickets there with native blocking links. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See
`docs/agents/domain.md`.
