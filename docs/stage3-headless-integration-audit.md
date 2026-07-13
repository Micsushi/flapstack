# Stage 3 Headless Integration Audit

Audit date: 2026-07-12. Branch baseline: `codex/stage3-integration` at
`6174aeacf03b30ae24587ab243ec9c4924c4bb60`.

This document preserves the pre-rebase headless evidence and the detailed MCP
manual rows. It does not complete live/manual rows. Stage 2 protection was
lifted on 2026-07-13; current work may use the verified `Flapstack Dev` app and
UI. The active integrated exit ledger is
`docs/stage3-full-feature-test-matrix.md`.

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
| M-01 | Start with exposure off in a Codex chat; list MCP tools                                     | Flapstack server absent; no caller process or audit row                                                                  | [x]    |
| M-02 | Enable exposure; start a new Codex run; call `ping` and `describe`                          | Connected state, trusted Codex chat/run identity, successful correlated audit rows                                       | [x]    |
| M-03 | Disable exposure; start another Codex run                                                   | Flapstack server absent; old child closed or stale caller denied                                                         | [ ]    |
| M-04 | Repeat M-01 through M-03 with Claude                                                        | Same default-off, enable, identity, disable, and stale behavior                                                          | [ ]    |
| M-05 | From active chat request a Tier 1 or Tier 2 mutation in ask-before-edits mode; approve once | Dialog shows caller/tool/tier/target/bounded input; mutation runs exactly once; audit shows required, allowed, completed | [x]    |
| M-06 | Repeat and deny                                                                             | No mutation; audit shows approval-required then denied                                                                   | [x]    |
| M-07 | Let approval time out                                                                       | Dialog closes; no mutation; timeout is returned and audited                                                              | [ ]    |
| M-08 | Request approval from background chat                                                       | Badge/notification appears without focus change; opening caller chat allows decision                                     | [ ]    |
| M-09 | Approve a lower-tier session grant, repeat same tool, then end run/chat session             | Grant works only in session; new session prompts again; grant use audited                                                | [x]    |
| M-10 | Attempt Tier 3 session grant                                                                | Reusable grant unavailable; every Tier 3 call prompts                                                                    | [x]    |
| M-11 | Claude caller spawns and launches Codex                                                     | One approval; child chat and first run execute; parent/initiator/ancestor lineage and audit IDs agree                    | [x]    |
| M-12 | Codex caller spawns and launches Claude                                                     | Same evidence in reverse direction                                                                                       | [x]    |
| M-13 | Deny each spawn direction                                                                   | No chat or run created; denial audited                                                                                   | [x]    |
| M-14 | Force target harness launch failure                                                         | Created durable chat remains; run is honest failure, never success; failure audited                                      | [x]    |
| M-15 | Attempt same-harness and recursive/duplicate-ancestor spawn                                 | Structured denial; no child created; reason audited                                                                      | [ ]    |
| M-16 | Attempt own chat archive/move and own run relaunch; rename the caller once                  | Forbidden self-references are denied; allowed rename preserves authenticated caller ownership; all are audited           | [x]    |
| M-17 | Stop spawned run from supported control                                                     | Run reaches stopped terminal state; lineage remains; action audited                                                      | [x]    |
| M-18 | Filter audit by caller, tool, decision, and time; page past first page                      | UI matches DB ordering/cursor; allowed, denied, timed-out, failed, completed visible                                     | [ ]    |
| M-19 | Submit credential-like and hidden-reasoning fixtures                                        | UI and SQLite contain redaction markers, no recoverable secret/reasoning                                                 | [ ]    |
| M-20 | Restart Stage 3 app and inspect exposure/audit                                              | Exposure remains accurate; audit persists; session grants do not                                                         | [x]    |

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

## 2026-07-13 MCP-first live closeout continuation

Branch `codex/stage3-mcp-live-closeout` started from integrated candidate
`03ef5bf79c3acba30d08b6843ebfbc233e7f67f0`. The ignored bundled Claude
2.1.207 binary was installed only for runtime proof. Isolated instance `93ea`
passed `npm run dev:verify` before each evidence interval and after restart,
naming this checkout and `~/Library/Application Support/Flapstack Dev 93ea`.
The shared `s3-mcp-closeout` lease covered every Dev and Computer Use interval
and was released cleanly.

Authenticated development test-control MCP supplied every functional action
and assertion. It proved:

- default-off refusal, exact per-caller enable/`next-run`/`connected`/disable
  state, Codex `ping` plus `describe`, Claude `ping`, and disable-time
  cancellation of the stdio session, pending approval, and caller run;
- active Tier 1 approval with caller/tool/tier/target/hashed input, exact-once
  mutation, denial, audited timeout, a reusable lower-tier grant within one
  persistent caller/run session, grant loss after restart, and fresh prompting
  in a new caller;
- Tier 3 had no session-grant option and prompted again in the same session;
- Codex-to-Claude child `7938cc69-6e29-4c89-93f0-954c8eea0c5c`, run
  `a07e9b84-b03e-42a5-8481-f481370dadf3`, completed `success` with exact text
  `CLAUDE_CHILD_READY`; Claude-to-Codex child
  `f2af2f7f-d20f-490a-8d85-76c78d255f02`, run
  `92147600-45cc-4cf0-bcc1-fe9a0b682e74`, completed `success` with exact text
  `CODEX_CHILD_READY`; both retained exact parent, initiator, ancestor, caller
  run, inherited worktree, permission, and audit correlation;
- denial in both directions created no extra child; same-harness spawn failed
  without a child; a worktree-less real Claude launch retained durable lineage
  and terminal `failure` instead of false success;
- caller self-archive, self-move, and self-launch failed closed. Caller rename
  remains intentionally allowed by the self-reference matrix, so dev-control
  ownership now survives that legal rename instead of relying on mutable text;
- child run `58d02fb3-9fce-4b1d-9788-cb3f32a9bded` reached `running`, accepted
  the authenticated cancel control, then reconciled to `cancelled` while its
  lineage remained;
- audit caller/tool/decision/time filters and distinct cursor pages matched
  durable order. A live credential-shaped marker was absent from the bounded
  state and replaced by byte length plus SHA-256. Restart preserved audit and
  exposure truth while clearing the caller session and reusable grant;
- cleanup archived 11 isolated callers, every terminal child, three mutation
  chats, and the temporary project fixture. All callers ended exposure-disabled
  with zero pending approvals and zero active caller or child runs.

Computer Use supplied only irreducible visual, accessibility-tree, and keyboard
evidence. The active dialog exposed the exact bounded context and Tier 1 grant
checkbox. Initial Tab testing found focus could escape into background controls;
using Radix AlertDialog action/cancel primitives repaired the trap, and the live
order then cycled Deny, Approve, grant checkbox, Deny. Tier 3 exposed no
checkbox. The background approval exposed its caller-scoped Review action.
No UI click performed a functional action or assertion.

Rows M-01, M-02, M-05, M-06, M-09 through M-14, M-16, M-17, and M-20 pass.
M-03/M-04 remain open for the exact complete Codex/Claude disable-repeat matrix;
M-07 for post-timeout dialog pixels; M-08 for a fresh external-app OS focus
observation; M-15 for live recursive/duplicate-ancestor denial; M-18 because the
audit query passed but its panel did not render after the temporary project
fixture left the renderer at its boot loader; and M-19 for hidden-reasoning plus
viewer/SQLite inspection. S3-F5-T3 also remains open for task membership,
accessible fork navigation, orchestration queue/scheduler/usage agreement, and
the remaining manual rows. S3-F6-T1/T2/T3/T5/T4 remain open on their listed
manual dependencies. No Preview, package, Windows, or Linux claim is made.
