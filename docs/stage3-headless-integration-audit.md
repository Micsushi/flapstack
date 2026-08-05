# Stage 3 Headless Integration Audit

Historical intermediate audit. Stage 3 later closed at 203/203 tasks and 48/48
matrix rows. Dated open findings below are retained as evidence chronology.

Audit date: 2026-07-12. Branch baseline: `codex/stage3-integration` at
`6174aeacf03b30ae24587ab243ec9c4924c4bb60`.

This document preserves the pre-rebase headless evidence and the detailed MCP
manual rows. It does not complete live/manual rows. Stage 2 protection was
lifted on 2026-07-13; current work may use the verified `Flapstack Dev` app and
UI. The active integrated exit ledger is
`docs/stage3-full-feature-test-matrix.md`.

Supersession note (2026-07-26): default-off and open-live-row statements below
describe this historical audit only. The current specification defaults new
supported chats on while preserving existing upgrade choices, and the active
matrix records the completed Windows live-management and restart evidence.

## Verified headless baseline

- Node 22.23.1 and npm 10.9.8.
- `npm ci --legacy-peer-deps` passed.
- Strict OpenSpec validation passed for all eight active changes.
- Focused MCP suite passed: 13 files and 56 tests.
- Full `npm run check` passed: lint, Prettier, strict TypeScript, 61 test files,
  494 passed, 3 skipped, and the production build.
- The build emitted `out/main/mcp-control-stdio.js`.
- The real MCP SDK stdio test listed the implemented catalog and called
  `ping`, `describe`, and `list_projects` through a child process.
- Historical migration evidence constructed the database at migration 0015 and
  applied the old Stage 3 0016-0021 chain. After rebasing onto main's new 0016,
  Stage 3 now uses one regenerated 0017. Fresh, main-era, and explicitly
  supported legacy upgrade tests remain open in S3-F2-T6.
- Per-chat custom capability toggles now persist in SQLite, reload after a
  database restart, and are revalidated on every call. Missing, malformed,
  partial, extra-key, stale, and unsupported permission state fails closed;
  launcher permission claims cannot override stored state; full-access Tier 3
  auto-approves, while every other writable mode still requires fresh approval.

## Requirement audit

| Area                              | Headless result                                                                                                     | Closeout state                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Transport                         | Real stdio SDK child passes; no loopback port                                                                       | Ready                                                                                |
| Caller identity                   | Launch identity, permission mode, and strict custom capability toggles are revalidated against SQLite for each call | Ready                                                                                |
| Exposure and harness registration | Historical default-off migration and Codex/Claude per-run registration exist                                        | Superseded by the current default-on supported-chat policy and live restart evidence |
| Tier 0 reads                      | Bounded project, task, chat, run, worktree, artifact, and search handlers pass                                      | Ready                                                                                |
| Mutations                         | Structured handlers, idempotent `launch_run`, approval, and DB-backed error tests pass                              | Headless ready; live approval evidence remains in the manual matrix                  |
| Permissions and self-reference    | Tier matrix and exhaustive self-reference tests pass                                                                | Core gate ready                                                                      |
| Approvals                         | Durable coordinator, app decision bridge, lifecycle, timeout, grant, and concurrency tests pass                     | Automated ready; active/background/timeout manual rows open                          |
| Audit                             | SQLite, redaction, filtering, paging, correlation, invocations, decisions, and grants pass                          | Automated ready; live decision/history manual rows open                              |
| Cross-agent spawn                 | Durable creation, lineage, both directions, launch consumption, restart recovery, and failure pass                  | Automated ready; real Codex and Claude evidence remains in S3-F5-T3                  |
| Safety UI                         | Exposure, approval, badge, and audit viewer model/component tests pass                                              | Code ready; manual UI rows open                                                      |

## Corrected task state

The audit reopened S3-F2-T5, S3-F3-T3, S3-F3-T4, S3-F4-T2, and S3-F5-T2.
S3-F2-T5 and S3-F5-T2 are now headless-complete through the shared app-router
launch path, durable queue, crash recovery, and DB-backed integration tests.
S3-F5-T3 remains open for real Codex and Claude evidence.

## Exact manual matrix

Stage 2 protection is cleared. Start only with `npm run dev`, then run
`npm run dev:verify` before evidence. The result must name this checkout and the
`Flapstack Dev` profile. UI automation, app focus, restart, and real provider
testing are allowed. Do not target a production or generic packaged app.

Record this header before testing:

```text
Date/time:
Tester:
OS and architecture:
Git branch and exact SHA:
Node/npm versions:
Executable path:
Flapstack Dev data directory:
Database path:
Codex version/auth status:
Claude version/auth status:
dev:verify checkout/profile evidence:
```

For each row, record request timestamp, caller chat/run IDs, target IDs,
approval ID, audit invocation ID, created chat/run IDs, final run status, and
artifact or screenshot paths. Mark PASS only when UI state, MCP response, and
SQLite audit/lineage agree.

| ID   | Action                                                                                      | Expected evidence                                                                                                        | Result |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| M-01 | Start with exposure off in a Codex chat; list MCP tools                                     | Flapstack server absent; no caller process or audit row                                                                  | [ ]    |
| M-02 | Enable exposure; start a new Codex run; call `ping` and `describe`                          | Connected state, trusted Codex chat/run identity, successful correlated audit rows                                       | [ ]    |
| M-03 | Disable exposure; start another Codex run                                                   | Flapstack server absent; old child closed or stale caller denied                                                         | [ ]    |
| M-04 | Repeat M-01 through M-03 with Claude                                                        | Same default-off, enable, identity, disable, and stale behavior                                                          | [ ]    |
| M-05 | From active chat request a Tier 1 or Tier 2 mutation in ask-before-edits mode; approve once | Dialog shows caller/tool/tier/target/bounded input; mutation runs exactly once; audit shows required, allowed, completed | [ ]    |
| M-06 | Repeat and deny                                                                             | No mutation; audit shows approval-required then denied                                                                   | [ ]    |
| M-07 | Let approval time out                                                                       | Dialog closes; no mutation; timeout is returned and audited                                                              | [ ]    |
| M-08 | Request approval from background chat                                                       | Badge/notification appears without focus change; opening caller chat allows decision                                     | [ ]    |
| M-09 | Approve a lower-tier session grant, repeat same tool, then end run/chat session             | Grant works only in session; new session prompts again; grant use audited                                                | [ ]    |
| M-10 | Attempt Tier 3 in full-access and ask-before-edits modes                                    | Full access auto-approves; ask mode prompts freshly; reusable Tier 3 grant remains unavailable                           | [ ]    |
| M-11 | Claude caller spawns and launches Codex                                                     | Full access needs no prompt; child chat and first run execute; parent/initiator/ancestor lineage and audit IDs agree     | [ ]    |
| M-12 | Codex caller spawns and launches Claude                                                     | Same evidence in reverse direction                                                                                       | [ ]    |
| M-13 | Deny each spawn direction                                                                   | No chat or run created; denial audited                                                                                   | [ ]    |
| M-14 | Force target harness launch failure                                                         | Created durable chat remains; run is honest failure, never success; failure audited                                      | [ ]    |
| M-15 | Attempt same-harness and recursive/duplicate-ancestor spawn                                 | Structured denial; no child created; reason audited                                                                      | [ ]    |
| M-16 | Attempt own chat archive/move/rename and own run relaunch                                   | Every forbidden self-reference is denied and audited                                                                     | [ ]    |
| M-17 | Stop spawned run from supported control                                                     | Run reaches stopped terminal state; lineage remains; action audited                                                      | [ ]    |
| M-18 | Filter audit by caller, tool, decision, and time; page past first page                      | UI matches DB ordering/cursor; allowed, denied, timed-out, failed, completed visible                                     | [ ]    |
| M-19 | Submit credential-like and hidden-reasoning fixtures                                        | UI and SQLite contain redaction markers, no recoverable secret/reasoning                                                 | [ ]    |
| M-20 | Restart Stage 3 app and inspect exposure/audit                                              | Exposure remains accurate; audit persists; session grants do not                                                         | [ ]    |

## Evidence template

```text
Row ID:
Result: PASS | FAIL | BLOCKED | NOT RUN
Started/finished:
Caller harness/chat/run:
Target harness/chat/run:
Permission mode and tier:
Approval ID and decision:
MCP response summary:
Audit invocation ID and ordered statuses:
Lineage fields:
UI evidence path:
SQLite query/evidence path:
Logs/evidence path:
Checkout/profile evidence:
Notes or limitation:
```

## Stage 3 closeout rule

Do not complete S3-F5-T3 or S3-F6-T4 until every required manual row passes on
real Codex and Claude sessions. Automated fixtures cannot replace those rows.

## 2026-07-13 MCP-first live closeout evidence

Branch `codex/stage3-mcp-live-closeout`, based on `d08502e`, ran the final
renderer/main code in isolated instance `93ea`. `npm run dev:verify` named this
checkout and `~/Library/Application Support/Flapstack Dev 93ea` after the final
restart. Real UI access held the shared `s3-mcp-closeout` lease; the app and
lease were stopped after evidence.

Authenticated development test-control MCP supplied every functional action
and assertion:

- isolated Codex and Claude callers started exposure-disabled and refused
  product calls while disabled;
- enabling reported `next-run`; real product stdio children completed `ping`
  and `describe` for both caller identities, and a waiting approval reported
  `connected`;
- Claude-to-Codex spawn approval created child
  `87d2a404-e22b-4184-b9ee-3c24207babd0`, run
  `bc61db5d-0b37-479f-8dce-9837754288e5`, exact parent/initiator/ancestor
  lineage, the inherited `93ea` checkout, terminal `success`, and assistant
  text `CODEX CHILD READY.`;
- Codex-to-Claude created the reverse child and inherited checkout, but its real
  Claude run ended `failure`. Startup logs showed a system Claude token but no
  bundled Claude binary and a provider stream error. This is failure evidence,
  not a two-way acceptance pass;
- denial in both directions resolved once and created no extra child;
- disabling during a pending spawn cancelled the stdio call, cleared the
  approval, cancelled the caller run, and kept that run stale after re-enable;
- audit tool/decision filters and cursor paging returned distinct ordered
  pages; the isolated recovery view had zero unresolved claims;
- after restart, exposure remained accurate as `next-run`, audit records
  persisted, non-MCP fixture runs were cancelled, and no approval/session grant
  survived;
- cleanup archived both callers and terminal children with zero active children,
  zero unarchived MCP test callers, and zero pending approvals.

Computer Use supplied only irreducible UI evidence. Accessibility inspection
showed a background `Review MCP approval in Chat ...` button. A prior same-code
focus observation kept VS Code's message input focused before and after the
MCP-created background approval. No UI click performed a functional control or
assertion. Active-chat dialog, full keyboard/screen-reader flow, session grants,
audit-viewer pixels, and stop-control pixels were not completed.

This evidence advances basic live spawn, exposure, stop, restart, audit, and
background-notification proof. It does not complete M-01 through M-20,
S3-F5-T3, or S3-F6-T4 because the documented matrix still requires two real
provider callers, a successful real Claude target launch, and the remaining
visual/accessibility rows.

Final automated verification: the focused MCP/management suite passed 54 tests
across 11 files. Node 22 `npm run check` passed lint, formatting, TypeScript,
117 test files with 863 passed and 3 conditional skips, and the production
build. Strict validation passed for `add-stage3-mcp-control`,
`add-dev-test-control-mcp`, and `validate-stage3-release`; release-ledger
coverage passed for 18 changes, 323 scenarios, and 17 feature exits.
