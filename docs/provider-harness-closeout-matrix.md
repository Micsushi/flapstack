# Provider harness closeout matrix

Snapshot: 2026-07-13. Owner: S3-F15. Task authority remains
`openspec/changes/close-provider-harnesses/tasks.md`.

This matrix freezes required evidence without treating fixtures, local CLI
probes, provider-live calls, UI-live runs, or package checks as interchangeable.
Every command and request has a deadline. Credentials use low-value accounts and
must not appear in commands, logs, screenshots, generated config, or evidence.

## Evidence classes

- **Fixture:** deterministic parser, event, failure, persistence, and cleanup tests.
- **CLI-live:** current local CLI/binary output without a paid provider turn.
- **Provider-live:** authenticated low-cost provider request and response.
- **Dev-headless:** verified `Flapstack Dev` runtime, API, and database evidence
  collected without claiming that the renderer was visually exercised.
- **UI-live:** verified `Flapstack Dev` chat/run behavior with persisted database evidence.
- **Package:** Preview/package binary, PATH, credential, config, and cleanup behavior.

`PASS` requires the named class on the exact commit. `BLOCKED` names a missing
credential, prerequisite, or platform. `UNSUPPORTED` is valid only when the UI
rejects or labels the capability before launch.

## Cursor D0-D5

| ID    | Required behavior                                                    | Classification           | Required evidence                       |
| ----- | -------------------------------------------------------------------- | ------------------------ | --------------------------------------- |
| D0-01 | Version, help, status, and models match the adapter                  | required                 | CLI-live + Fixture                      |
| D0-02 | Headers/errors never become model IDs; probes time out and clean up  | required                 | Fixture + CLI-live                      |
| D1-01 | Cursor identity/chip appears across create, header, sidebar, and run | required                 | UI-live + Package                       |
| D2-01 | Authenticated stream, persistence, stop, and continuation            | credential-conditional   | Provider-live + UI-live                 |
| D2-02 | Reasoning final/delta ordering and dedupe                            | required                 | Fixture + UI-live when emitted          |
| D2-03 | Structured/zero-exit/EPIPE failures reach terminal failure           | required                 | Fixture + UI-live                       |
| D3-01 | Browser login and disconnected/connected recovery are honest         | credential-conditional   | CLI-live + UI-live                      |
| D3-02 | API key remains environment-only and redacted                        | credential-conditional   | Fixture + Provider-live + Package       |
| D4-01 | Permission preview names exact flags and limitations before launch   | required                 | Fixture + UI-live                       |
| D4-02 | Read-only/ask/full-access behavior matches current CLI limits        | prerequisite-conditional | UI-live; S3-F12-T5                      |
| D5-01 | Exact selected model persists through create, continuation, restart  | credential-conditional   | Provider-live + UI-live + DB inspection |
| D5-02 | Images reject before launch                                          | unsupported-required     | Fixture + UI-live                       |

## OpenRouter and NanoGPT E1-E7

| ID    | Required behavior                                                            | Classification           | Required evidence                                    |
| ----- | ---------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------- |
| E1-01 | Provider identity and exact model persist across chat/sub-chat/run           | required                 | Fixture + UI-live                                    |
| E2-01 | Isolated sidecar starts, health-checks, resolves package PATH, and cleans up | required                 | Fixture + UI-live + Package                          |
| E2-02 | SSE subscribes before async prompt; prompt/approval deadlines cancel         | required                 | Fixture + UI-live                                    |
| E3-01 | Secure key storage and environment-only generated config                     | prerequisite-conditional | S3-F10-T4 + Package                                  |
| E3-02 | Missing key/model/binary fails before provider work                          | required                 | Fixture + UI-live                                    |
| E4-01 | Low-cost OpenRouter text/reasoning turn persists successfully                | credential-conditional   | Provider-live + UI-live                              |
| E4-02 | Low-cost NanoGPT text/reasoning turn persists successfully                   | credential-conditional   | Provider-live + UI-live                              |
| E5-01 | Exact approval request shows command/patterns/paths                          | prerequisite-conditional | S3-F6-T2 + S3-F12-T5 + UI-live                       |
| E5-02 | Allow-once/reusable/deny returns once and persists/audits                    | prerequisite-conditional | S3-F3-T4 + S3-F4-T2 + S3-F6-T2 + S3-F12-T5 + UI-live |
| E5-03 | Missing approval handler fails closed                                        | required                 | Fixture                                              |
| E6-01 | Terminal state, artifacts, overlapping runs, and message IDs remain coherent | credential-conditional   | Fixture + Provider-live + UI-live + DB inspection    |
| E6-02 | Optional usage failure cannot strand a running chat                          | required                 | Fixture                                              |
| E6-03 | Multi-step OpenRouter generations retain exact IDs and cost provenance       | credential-conditional   | Provider-live + UI-live + DB inspection              |
| E7-01 | Key status, catalog source, seed, chips, and selection agree                 | required                 | Fixture + UI-live                                    |
| E7-02 | Authenticated catalogs retain current capability metadata after reload       | credential-conditional   | Provider-live + UI-live                              |
| E7-03 | Spoken/Displayed instructions reach both provider prompts                    | credential-conditional   | Provider-live + UI-live                              |

## Current capability baseline

- Cursor local CLI: `2026.07.09-a3815c0` on macOS arm64. Re-run the bounded
  probe after any CLI update and bind output to the tested commit.
- Cursor `auto` is the current CLI-reported default. A low-risk authenticated
  CLI turn and continuation passed with one stable session on 2026-07-13; this
  is CLI/provider evidence, not Flapstack UI or database evidence.
- OpenCode sidecar fallback: pinned `opencode-ai@1.17.18`. Standalone `opencode`
  is absent on this machine; package/runtime evidence must exercise the npx or
  packaged resolution actually used.
- Cursor commands are project-scoped `.cursor/commands/*.md`; Cursor MCP uses
  `.cursor/mcp.json` and current CLI MCP commands.
- OpenCode model truth comes from authenticated OpenRouter/NanoGPT catalogs.
  CLI help and static seeds are never provider-live model evidence.
- Current NanoGPT seeds are `deepseek/deepseek-latest` and
  `zai-org/glm-latest`. A fresh persisted dev-headless turn proved
  `zai-org/glm-latest` chat-compatible on 2026-07-13; the UI-live row remains
  open.

## Current closeout evidence and blockers

Credential and permission/custom-capability code prerequisites are integrated
at base `5297ed777d0430f468ef23def55119f51d87795b`. Their acceptance rows remain
open: S3-F10-T4 still lacks packaged credential migration/restart/removal,
actual Keychain-backed persistence, and Windows/Linux proof; S3-F12-T5 still
lacks its prerequisite acceptance and unlocked live UI proof. S3-F6-T2 still
lacks active/background approval UI rows.

Safe 2026-07-13 evidence from this worktree:

- Cursor CLI-live: authenticated `auto` turn and same-session continuation
  passed. The adapter now uses `auto`, bounds chat lifetime, and reuses one
  logical user turn during auth recovery. Flapstack UI/database, restart, and
  cancellation rows remain open.
- OpenRouter dev-headless: run
  `c0300c51-0604-4554-b5b3-887c1a1292d2` persisted exact provider/model,
  before/after checkpoints, usage, session identity, and terminal success. A
  first probe exposed conflicting duplicate reasoning options; the runtime
  config was corrected and the fresh run passed.
- NanoGPT dev-headless: run
  `e19a8846-c0ee-4378-ba01-89b7f0bd0b1e` proved the current
  `zai-org/glm-latest` seed and persisted terminal success.
- Provider approvals: OpenRouter deny run
  `8084e7f3-8f84-4656-85c2-a4820ca82f9f`, NanoGPT allow-once run
  `826b47d5-b830-43f3-8e17-3d9db7489271`, and NanoGPT cancellation run
  `da4a0da4-5cc6-4e82-b85f-33fbd0fdee3d` persisted exact command/pattern,
  user decision, terminal state, and checkpoints. This proves the headless
  provider bridge, not visual approval UI or exact project-boundary behavior.
- All six probe chats were archived, no approvals remained pending, and no
  isolated sidecar directory remained under `/tmp`.

S3-F15-T2 stays open for Flapstack UI/database auth-retry, stop, continuation,
restart, exact-model, and S3-F12 live enforcement evidence. T3 stays open for
verified renderer evidence; Preview arm64 package resolution/inspection passes.
T4 stays open for S3-F12/S3-F6 visual permission/approval evidence and UI/audit
correlation. T5 stays open until T2-T4 and every required UI/cross-platform row
passes.

## 2026-07-13 SHA-bound evidence record

```text
Date/time: 2026-07-13 America/Vancouver
Implementation commit: 99672b7fc3607e84cc478f981e35b8c69c9343b8
OS + architecture: macOS arm64
Node/Electron version: Node 22.23.1; Electron 39.8.10
Dev or Preview/package: Flapstack Dev + unsigned Flapstack Preview arm64
Evidence class: Fixture, CLI-live, provider-live, dev-headless, package
Passed: focused provider/permission suites; strict close-provider-harnesses;
  npm run dev; npm run dev:verify; Node 22 npm run check (746 passed, 3 skipped);
  Preview package; package inspect; bundled Claude/Codex/Whisper/Parakeet smoke;
  packaged ACP stale-session fallback and product-MCP server identity
Failed then fixed: first OpenRouter probe rejected duplicate conflicting
  reasoning fields; corrected config passed a fresh run
Blocked/unavailable: locked visual Cursor/provider/approval/permission rows;
  S3-F10-T4 packaged credential lifecycle, actual Keychain, Windows/Linux;
  S3-F12-T5 prerequisite acceptance and live UI; S3-F6-T2 visual approval UI
Provider/CLI versions: Cursor 2026.07.09-a3815c0; OpenCode fallback 1.17.18;
  Claude Code 2.1.207; Codex CLI 0.144.1
Sanitized chat/run IDs: archived chats only; OpenRouter success c0300c51...;
  NanoGPT success e19a8846...; deny 8084e7f3...; allow 826b47d5...;
  cancel da4a0da4...
Cleanup proof: six probe chats archived; zero pending approvals; no
  /tmp/flapstack-opencode-* directories; dev stopped; no credential emitted
Notes: headless evidence does not prove renderer visuals, provider parity, or
  exact project-boundary enforcement
```

## 2026-07-13 integrated-candidate continuation

The isolated `acbf-cont` profile reported OpenRouter and NanoGPT unconfigured,
with only their shipped seed models available. Cursor, OpenRouter, and NanoGPT
credential presence was false, and the app-scoped Claude token was absent.
Injected question requests proved provider-adapter capability declarations and
shared lifecycle cleanup, not provider runtime behavior. No credential was
created or copied and no paid call ran. S3-F15-T2 through S3-F15-T5 remain open.

## Evidence record

```text
Date/time:
Commit:
OS + architecture:
Node/Electron version:
Dev or Preview/package:
Evidence class:
Row IDs:
Passed:
Failed:
Blocked/unavailable:
Provider/CLI versions (no secrets):
Chat/run/database IDs:
Sanitized logs/screenshots:
Cleanup proof:
Notes:
```
