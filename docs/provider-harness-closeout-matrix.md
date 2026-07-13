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
- OpenCode sidecar fallback: pinned `opencode-ai@1.17.18`. Standalone `opencode`
  is absent on this machine; package/runtime evidence must exercise the npx or
  packaged resolution actually used.
- Cursor commands are project-scoped `.cursor/commands/*.md`; Cursor MCP uses
  `.cursor/mcp.json` and current CLI MCP commands.
- OpenCode model truth comes from authenticated OpenRouter/NanoGPT catalogs.
  CLI help and static seeds are never provider-live model evidence.
- Current NanoGPT seeds are `deepseek/deepseek-latest` and
  `zai-org/glm-latest`; neither may close E4-02 until a minimal live completion
  proves current chat compatibility.

## Exact blockers and wake conditions

S3-F11 commit `b02055c56ac7a1c79fa49be49a2ba01730f66d5e` adds
authenticated dev-only extension inventory/mutation probes and macOS Preview
resource smoke. That evidence is not provider-live or UI-live D/E evidence and
does not close any S3-F15-T2 through T5 row.

- S3-F15-T2 wakes after S3-F10-T4 and S3-F12-T5 pass and S3-F15-T1 is integrated.
- S3-F15-T3 wakes after S3-F10-T4 passes; dev-test-control MCP 3.3/3.4 already pass.
- S3-F15-T4 wakes after S3-F15-T3, S3-F12-T5, S3-F3-T4, S3-F4-T2, and S3-F6-T2 pass.
- S3-F15-T5 wakes after T2, T3, and T4 pass.

At this snapshot S3-F3-T4, S3-F4-T2, and dev-test-control MCP 3.3/3.4 are
complete. S3-F10-T4, S3-F12-T5, and S3-F6-T2 remain open.

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
