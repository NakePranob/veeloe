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
change the ADR in the same PR. `openspec/` holds the specs and changes for
every part, versioned with the code.

GitHub Releases are for the Runtime only — its updater takes the latest
release as its own (ADR 0009, 0025). The Hub ships as an image on GHCR, the
Controller through EAS.

Outside contributors sign the CLA (CLA Assistant) on their first PR. Do not
merge an outside contribution until the CLA check is green: relicensing and
the App Store build both depend on it (ADR 0016).

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

Branch off `develop` as `<type>/<summary>`, with the issue number first when
there is one — `feat/12-login-form`.

## Pull requests

Base is `develop`. `main` is promoted from it, so nothing targets `main`
directly — dependabot included (`target-branch: develop`). Both are guarded by
repo rulesets (Settings → Rules): no direct push, no force-push, no deletion —
everything lands through a PR. `develop` merges by squash only and needs the
`english` check (`.github/workflows/pr-title.yml`) green; `main` merges by
merge commit only, so promoting `develop` never forks the two histories. No
approval is required — PRs are self-merged.

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
