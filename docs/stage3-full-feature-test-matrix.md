# Stage 3 full-feature test matrix

Snapshot: 2026-07-13. This is the active user-facing exit matrix for Stage 3.
OpenSpec `tasks.md` files remain the only implementation task checklists. This
document records integrated and manual evidence; it does not replace them.

Stage 3 is complete only when all required rows pass on the named platforms.
Blocked or unavailable evidence stays unchecked and is reported as a limitation.

## 0. Identity and automated gate

- [ ] **S3-P01** `codex/stage3-integration` contains current `main`; `main` is
      clean and unchanged by Stage 3 development.
- [ ] **S3-P02** Node 22 `npm run check` passes after the final code change.
- [ ] **S3-P03** every active Stage 3 OpenSpec change passes strict validation.
- [ ] **S3-P04** fresh, `main`-era, and supported legacy databases migrate
      without losing Stage 2 data; schema and Drizzle journal match.
- [ ] **S3-P05** `npm run dev:verify` identifies this checkout and the
      `Flapstack Dev` profile after the final restart.
- [ ] **S3-P06** macOS Preview packaging passes; Windows/Linux package evidence
      is recorded as passed or explicitly remaining.

## 1. Production MCP control (S3-F2 through S3-F6)

- [ ] **S3-M01** per-chat exposure is off by default and only the selected chat
      receives the production stdio server.
- [ ] **S3-M02** Tier 0 reads are paginated, scoped, redacted, and reachable in
      read-only Claude and Codex without allowing arbitrary third-party MCP tools.
- [ ] **S3-M03** mutations enforce caller identity, permission mode, worktree
      boundary, self-reference rules, and exactly one user approval where required.
- [ ] **S3-M04** Tier 3 launch/spawn always requires fresh approval; denial,
      timeout, success, and failure each create one complete audit record.
- [ ] **S3-M05** queued Claude/Codex launches reuse one run ID, survive restart
      according to policy, and cannot drain unrelated pending runs.
- [ ] **S3-M06** product MCP mutations refresh affected renderer queries without
      restart; dev-test MCP remains a separate authenticated test boundary.
- [ ] **S3-M07** audit filtering, pagination, approval UI, exposure controls,
      connection state, and self-reference diagnostics pass in the live dev app.

## 2. Settings reliability (S3-F7 through S3-F13)

- [ ] **S3-S01** only honest, implemented tabs appear; every visible tab is
      directly routable and searchable.
- [ ] **S3-S02** editable keyboard shortcuts use one registry for display,
      persistence, conflict detection, runtime dispatch, reset, and focus policy.
- [ ] **S3-S03** voice selectors control real adapters/models; Prefer offline,
      voice, playback rate, history, and error/download states match runtime.
- [ ] **S3-S04** secrets use write-only renderer APIs and approved encrypted
      persistence/migration paths; no key appears in logs, IPC, exports, or audit.
- [ ] **S3-S05** provider extensions show accurate discovery, scope, duplicate,
      mutation, and runtime-consumption behavior.
- [ ] **S3-S06** permission changes support current/all-chat scope and remembered
      behavior; custom capabilities persist exactly and clear when custom ends.
- [ ] **S3-S07** copy and Settings search use the same visibility/route registry
      and never expose unavailable destinations or stale provider claims.

## 3. Migrated Stage 2 closeout

The historical row text remains in `docs/stage2-full-feature-test-matrix.md`.
These groups are now owned by Stage 3 features and their OpenSpec task boards.

- [ ] **S3-V01 (S3-F9)** migrated Voice rows `V2-*` through `V9-*` pass with
      Parakeet streaming as the default, Whisper batch fallback, review-before-
      send composer behavior, recording-origin safety, and Voice History CRUD.
- [ ] **S3-V02 (S3-F9)** the active `docs/voice-manual-matrix.md` passes on
      macOS; Windows/package gaps remain explicit until observed.
- [ ] **S3-U01 (S3-F14)** migrated Usage rows `U1-*` through `U11-*` pass for
      engine, store, daemon, providers, reconciliation, alerts, and dashboard.
- [ ] **S3-H01 (S3-F15)** migrated Cursor rows `D1-*` through `D5-*` and
      OpenRouter/NanoGPT rows `E1-*` through `E7-*` pass in live UI and package
      contexts; NanoGPT defaults name a currently chat-capable tested model.
- [ ] **S3-R01 (S3-F16)** migrated reasoning rows `T1-*` through `T7-*` pass for
      fixtures, streaming, persistence, search, capability fallback, and live
      provider evidence.
- [ ] **S3-C01 (S3-F17)** migrated preflight rows `P-01` through `P-10` and MVP
      carryover rows `F3-*` through `F11-*` pass without regressing Stage 1/2.

## 4. Final integrated release gate (S3-F17)

- [ ] **S3-X01** a clean-profile walkthrough creates/opens project, task, chat,
      worktree, run, artifact, checkpoint, and production MCP control paths.
- [ ] **S3-X02** Claude, Codex, Cursor, OpenRouter, and NanoGPT each pass every
      credential-available launch, permission, reasoning, and persistence path.
- [ ] **S3-X03** restart recovery, database migration, daemon lifecycle, and
      product MCP external mutation refresh pass after the final code change.
- [ ] **S3-X04** macOS live dev and Preview package pass. Windows/Linux checks
      are run where available and otherwise recorded as unverified, never implied.
- [ ] **S3-X05** three review/fix rounds find no unresolved correctness,
      security, data-loss, permission, migration, or release-blocking issue.
- [ ] **S3-X06** README, UI guidance, OpenSpec proposals/specs/designs/tasks,
      stage routers, test matrices, and handoff all describe the same shipped
      behavior and remaining limitations.

## Evidence record

Record one entry per run:

```text
Date/time:
Commit:
OS + architecture:
Node/Electron version:
Dev or Preview/package:
Row IDs:
Passed:
Failed:
Blocked/unavailable:
Provider/CLI versions (no secrets):
Logs/screenshots:
Notes:
```
