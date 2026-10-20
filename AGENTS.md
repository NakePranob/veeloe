# Agent Guidance: veeloe

This is the open repo (`veeloe` on GitHub): the Veeloe Protocol and Runtime,
under AGPL-3.0 (`LICENSE`). It is **public** — everything pushed here, a commit
message or a PR description included, is public the moment it lands. The
maintainers' design documents live outside this repo and are private; do not
copy anything from them here without checking it holds nothing private. `CONTEXT.md` is the
shared glossary — use its terms.

`openspec/` holds the specs and changes for the Protocol and Runtime, versioned
with the code. They are public like the rest: keep private or business
decisions out of them.

Outside contributors sign the CLA (CLA Assistant) on their first PR. Do not
merge an outside contribution until the CLA check is green.

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

Branch off `develop` as `<type>/<summary>`, with the ticket number when there
is one — `feat/abc-12-login-form`.

## Pull requests

Base is `develop`. `main` is promoted from it, so nothing targets `main`
directly — dependabot included (`target-branch: develop`). Both are guarded by
repo rulesets (Settings → Rules): no direct push, no force-push, no deletion —
everything lands through a PR. `develop` merges by squash only and needs the
`english` check (`.github/workflows/pr-title.yml`) green; `main` merges by
merge commit only, so promoting `develop` never forks the two histories. No
approval is required — PRs are self-merged.

Title in English, same shape as a commit subject, and if there are tickets
they go after it, separated by ` · `: `feat: ✨ login form (ABC-12)`,
`feat: ✨ dealer master data (ABC-32 · REQ-5.4)`. The description is Thai — it
is what the team reads.

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
was checked versus what a reviewer still has to click. A PR closing a ticket
answers its Acceptance Criteria one by one; plenty of PRs have no ticket at
all. The usual sections, each bullet led by a **bold label**:

- `## ทำไม` (or `## ปัญหา` / `## สาเหตุ` for a fix)
- `## ทำอะไร`
- `## ตรวจแล้ว`
- `## ยังต้องกดดู` — `- [ ]` steps a reviewer clicks through
- `## ข้อจำกัด` — ends with `**ไม่มี ticket**` when there is none
