# Stage 3 Headless Integration Audit

Audit date: 2026-07-12. Branch baseline: `codex/stage3-integration` at
`6174aeacf03b30ae24587ab243ec9c4924c4bb60`.

This document records headless evidence only. It does not complete live or
manual rows. Stage 2 app data and processes were not touched.

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
- A migration test now constructs the database at migration 0015, inserts a
  Stage 2 chat, applies migrations 0016 through 0021, and verifies default-off
  exposure, null-safe custom permissions, plus audit and approval storage.
- Per-chat custom capability toggles now persist in SQLite, reload after a
  database restart, and are revalidated on every call. Missing, malformed,
  partial, extra-key, stale, and unsupported permission state fails closed;
  launcher permission claims cannot override stored state, and Tier 3 still
  requires fresh approval.

## Requirement audit

| Area                              | Headless result                                                                                                     | Closeout state                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Transport                         | Real stdio SDK child passes; no loopback port                                                                       | Ready                                                               |
| Caller identity                   | Launch identity, permission mode, and strict custom capability toggles are revalidated against SQLite for each call | Ready                                                               |
| Exposure and harness registration | Default-off migration and Codex/Claude per-run registration exist                                                   | Automated ready; restart/reconnect manual row open                  |
| Tier 0 reads                      | Bounded project, task, chat, run, worktree, artifact, and search handlers pass                                      | Ready                                                               |
| Mutations                         | Structured handlers, idempotent `launch_run`, approval, and DB-backed error tests pass                              | Headless ready; live approval evidence remains in the manual matrix |
| Permissions and self-reference    | Tier matrix and exhaustive self-reference tests pass                                                                | Core gate ready                                                     |
| Approvals                         | Durable coordinator, app decision bridge, lifecycle, timeout, grant, and concurrency tests pass                     | Automated ready; active/background/timeout manual rows open         |
| Audit                             | SQLite, redaction, filtering, paging, correlation, invocations, decisions, and grants pass                          | Automated ready; live decision/history manual rows open             |
| Cross-agent spawn                 | Durable creation, lineage, both directions, launch consumption, restart recovery, and failure pass                  | Automated ready; real Codex and Claude evidence remains in S3-F5-T3 |
| Safety UI                         | Exposure, approval, badge, and audit viewer model/component tests pass                                              | Code ready; manual UI rows open                                     |

## Corrected task state

The audit reopened S3-F2-T5, S3-F3-T3, S3-F3-T4, S3-F4-T2, and S3-F5-T2.
S3-F2-T5 and S3-F5-T2 are now headless-complete through the shared app-router
launch path, durable queue, crash recovery, and DB-backed integration tests.
S3-F5-T3 remains open for real Codex and Claude evidence.

## Exact manual matrix

Run only after Stage 2 protection is explicitly cleared. Use an isolated Stage
3 data directory and a Stage 3 build. Do not use the Stage 2 dev profile. Do
not let the test launcher activate or focus another app window.

Record this header before testing:

```text
Date/time:
Tester:
OS and architecture:
Git branch and exact SHA:
Node/npm versions:
Executable path:
Stage 3 data directory:
Database path:
Codex version/auth status:
Claude version/auth status:
Stage 2 process/profile untouched evidence:
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
| M-10 | Attempt Tier 3 session grant                                                                | Reusable grant unavailable; every Tier 3 call prompts                                                                    | [ ]    |
| M-11 | Claude caller spawns and launches Codex                                                     | One approval; child chat and first run execute; parent/initiator/ancestor lineage and audit IDs agree                    | [ ]    |
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
Focus before/after:
Stage 2 protection check:
Notes or limitation:
```

## Stage 3 closeout rule

Do not complete S3-F5-T3 or S3-F6-T4 until every required manual row passes on
real Codex and Claude sessions. Automated fixtures cannot replace those rows.
