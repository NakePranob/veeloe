# Port to Rust + Flutter — progress

## 2026-11-10 01:45 (Asia/Bangkok) — BLOCKED: change does not exist on disk

The scheduled port loop could not pick a task: **none of the artifacts this change depends on exist in this workspace.**

What is missing (verified, not assumed):

- `openspec/changes/2026-11-08-port-to-rust-flutter/tasks.md` — absent. This file was created by this run as the only record; `tasks.md`, `proposal.md`, `design.md` and `parity-audit-2026-11-09.md` do not exist and were **not** reconstructed, because inventing the task list would fabricate the spec.
- Flutter controller — absent. `controller/` is still the legacy Expo Router app (`controller/package.json` → `@veeloe/controller` with `expo-router/entry`, `app/*.tsx`, `+native-intent.tsx`). There is no `controller/lib/features` or `controller/lib/shared`.
- Rust runtime — absent. `packages/runtime/src` is TypeScript (`main.ts`, `help.ts`, `ipc.ts`, `supervisor/`, `worker/`). No `Cargo.toml` anywhere in the repository.
- No `*-legacy` packages or `controller-legacy`, i.e. the legacy → `-legacy` rename that precedes Phase 5 never happened.

Evidence gathered:

- `ls openspec/changes` → only `archive/` (16 archived changes, latest `2026-11-07-stop-and-restart`).
- `find . -name "parity-audit-*.md" -o -name "progress.md"` (excluding `node_modules`) → no hits.
- `mdfind -name "port-to-rust-flutter"` and `mdfind -name "pubspec.yaml"` → no hits on this Mac; no `Cargo.toml`/`pubspec.yaml` under `projects/`.
- `git log --all --oneline | grep -iE "rust|flutter|port"` → no commits.
- `git status` → clean at `ce7bdd2` on `develop` except `M e2e/agent-task.test.ts`, `?? media/`, `?? memory/`.
- Toolchains are installed (`flutter`, `dart`, `cargo` on PATH), so absence is of the work, not of the tools.

Interpretation: the port was never started in this workspace, or its directory was removed (the change folder is untracked, so a checkout/reset would not restore it). The automation's "known state" (5.8b-1, 5.9-1, 5.9-7 done; row 62 attempted) cannot be reconciled with the filesystem.

Blocked on: a user decision — restore the port change directory (tasks, progress, parity audit) from wherever it lives, or re-author the change from scratch, or retire this loop.

Next run: if `tasks.md` is still missing, do not re-run the discovery above and do not start Phase 0 unilaterally; stop and report this blocker again.

## 2026-11-10 01:5x (Asia/Bangkok) — BLOCKED again, and the tree is busy: no task started

Second run of the port loop. `tasks.md` and `parity-audit-2026-11-09.md` are still absent — the change folder holds only this file. No task could be picked, so nothing was edited, no check was run by this loop.

The repository did change since the previous row, and not by this loop. Verified state:

- `packages/protocol/` is now Rust: `Cargo.toml`, `Cargo.lock`, `src/{allowlist,backoff,base64url,certificate,crypto,envelope,frame,hub_auth,lib,linking,messages,pairing,signer,uri}.rs`, `tests/`.
- `packages/runtime/` is now Rust: `Cargo.toml` with crates `plugin-api`, `runtime-core`, `runtime-supervisor`, `runtime-worker` (its `src/` TypeScript is gone).
- The legacy rename that precedes Phase 5 has happened: `packages/protocol-legacy/` and `packages/runtime-legacy/` exist, both untracked.
- `controller/` is still the Expo Router app with Feature-Sliced Design under `src/` (per `controller/AGENTS.md`, ADR 0022); `app/` still holds the routes `index, add-machine, link, devices, machines, tasks, usage, workspace, agents/, +native-intent, _layout`. There is **no** `controller/lib/features`, no `controller-legacy/`, and no `pubspec.yaml` anywhere under `projects/` — so the Flutter half of this change has not started.
- `git status --short` → 196 entries, 30+ tracked files modified outside this loop; `git worktree list` → the single tree at `ce7bdd2` on `develop`; no `index.lock`.
- A build of that other work was live during this run: processes `bun run check` → `bun run check:prototype` → `bun test` were running with cwd `projects/veeloe`.

Blocked on two things, both needing a person:

1. The plan this loop executes does not exist on disk: restore `tasks.md` (and the parity audit) into this change folder, or point the loop at wherever the real task list lives.
2. A concurrent session is mid-flight in the same working tree. Starting a task here would edit files another agent is verifying right now, so this loop stops instead of racing it.

Next run: same rule as before — if `tasks.md` is still missing, do not build anything and do not redo discovery; report the blocker. If `tasks.md` is back, re-read it and re-verify the dirty-tree state before touching a file.

## 2026-11-10 01:55 (Asia/Bangkok) — BLOCKED (third run): no task list, nothing started

Confirmed the recorded blocker still holds, without redoing discovery:

- `openspec/changes/2026-11-08-port-to-rust-flutter/` contains only `progress.md` (4735 bytes). `tasks.md` and `parity-audit-2026-11-09.md` are still absent; `mdfind -name tasks.md | grep port-to-rust` → no hits.
- Nothing was edited this run and no check was run by this loop. No task could be picked because there is no task list to pick from; inventing one would fabricate the spec that defines "parity".
- The concurrent `bun run check` chain from the previous row has finished (no `bun check/test` or `cargo` process running; only the IDE's flutter/dart daemons).
- `git status --short` in `projects/veeloe` → 196 entries, unchanged from the previous row. The working tree is still carrying another session's in-flight work, so even with a task list this loop should re-verify that state before editing.

Still blocked on the same user decision: restore `tasks.md` (plus the parity audit) into this change folder, or point this loop at wherever the real task list lives, or retire the job. Until then every scheduled run ends here by design.

Next run: if `tasks.md` is still missing, append nothing further — the record is already sufficient — and report the blocker once.

## 2026-11-10 02:5x (Asia/Bangkok) — RETIRED: the Flutter half was abandoned, the Rust half shipped

Closed with this change folder archived, not completed. Final state, verified:

- **Rust Runtime is the only Runtime.** `packages/runtime` (crates `plugin-api`, `runtime-core`, `runtime-supervisor`, `runtime-worker`) builds the `veeloe` binary; `scripts/runtime.ts` builds only it, and `VEELOE_RUNTIME` is gone.
- **`packages/runtime-legacy` was deleted** (snapshot at `~/Backups/veeloe-pre-cleanup-20261110-025505.tgz`). Its only remaining piece, the test-only `fake-provider.ts`, moved to `e2e/helpers/fake-provider.ts`; `e2e/rollback.test.ts` was removed with the rollback path.
- **`packages/protocol` (Rust) stays the source of truth**, and the TypeScript client the Controller runs on Hermes was renamed `@veeloe/protocol-ts` (was `@veeloe/protocol-legacy`). Rust and TS are held together by `bun run check:protocol` over the shared vectors.
- **No Flutter controller was ever built.** The Controller is the Expo Router React Native app under `controller/` (Feature-Sliced Design), and it stays that way.
- A wasm build of the Rust protocol for the Controller was evaluated and rejected: Hermes in Expo Go has no `WebAssembly` global (probed on the Simulator, `typeof WebAssembly === "undefined"`), so a wasm binding there would need a polyfill and would be slower than the TS binding.

Next: no further work under this change. New Controller or Runtime work gets its own change.
