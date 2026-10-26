# Agent Guidance: veeloe

This is the whole of Veeloe (`veeloe` on GitHub), under AGPL-3.0 (`LICENSE`):
Protocol (`packages/protocol`), Runtime (`packages/runtime`), Hub (`hub/`),
Controller (`controller/`) and the e2e seam tests (`e2e/`). It is **public** —
everything pushed here, a commit message or a PR description included, is
public the moment it lands. Never commit a secret: the Runtime release signing
key, push and Expo credentials, billing keys and the hosted Hub's env stay in
GitHub environments or the host, never in git.

`CONTEXT.md` is the glossary — use its terms. `docs/adr/` holds the
architecture decisions: do not contradict one; if a change has to, say so and
change the ADR in the same commit. `openspec/` holds the specs and changes for
every part, versioned with the code.

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

`check` runs the type check and each part's structure check (ADR 0022):
Steiger on the Controller, dependency-cruiser on the Runtime and
`go-scaffold check` on the Hub. `test` runs the Protocol's, the Runtime's and
the Controller's unit tests. `bun run --cwd e2e test` starts Postgres in Docker, applies the
Hub's migrations, builds the Runtime binary and starts the real Hub, then runs
the seam tests; it needs Go and Docker. CI runs all three, plus the Hub's
build, lint and tests.

The JSON Schema and test vectors in `packages/protocol/schema/` and
`packages/protocol/vectors/` are generated; after changing the envelope or the
handshake, rebuild them with `bun run --cwd packages/protocol fixtures`. The
Hub's Go tests read the same files.

In `hub/`, never run `go-scaffold add auth`, `add rbac` or `add worker`
(ADR 0014).

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
PR. Run `bun run check` (and the e2e tests when the change touches a seam)
before pushing, because nothing on GitHub gates the push — CI runs after it
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
