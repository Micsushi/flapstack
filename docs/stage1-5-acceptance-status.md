# Stage 1–6 implementation and acceptance status

Snapshot: 2026-08-05. The filename is retained for existing links. Completion
terminology comes from
[`completion-tiers.md`](completion-tiers.md). Tier 3 owner checks are kept in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md) and do not
change whether implementation is complete unless explicitly labeled
`release-blocking`.

## High-level status

| Stage   | Tier 1 code | `T2-core` accepted | Capability certified | Release certified | Current meaning                                                                                                             |
| ------- | ----------- | -----------------: | -------------------: | ----------------: | --------------------------------------------------------------------------------------------------------------------------- |
| Stage 1 | 100%        |               100% |                  n/a |               n/a | Implementation complete; archived board is 28/28.                                                                           |
| Stage 2 | 100%        |               100% |                  n/a |               n/a | Implementation complete; archived board is 74/74 and later exit evidence was absorbed into Stage 3.                         |
| Stage 3 | 100%        |               100% |                  n/a |               n/a | Implementation and current integrated matrix are complete (48/48).                                                          |
| Stage 4 | 100%        |              52/52 |                 0/12 |               0/1 | Implementation complete at Tier 2. Optional providers/remotes and the packaged macOS release remain separately uncertified. |
| Stage 5 | 100%        |              40/40 |                 0/21 |              0/14 | Implementation complete at Tier 2; optional capabilities and distributable-release certification remain separate.           |
| Stage 6 | 100%        |              60/60 |                 0/10 |              0/16 | Implementation complete at Tier 2; optional capabilities and public-distribution evidence remain separately uncertified.    |

These are evidence-row counts, not completion percentages. The former Stage 4
`5/65` and Stage 5 `15/69` aggregates mixed core implementation, optional
capabilities, release certification, and one tracking-only row. They must not
be used to decide whether the implementation is complete.

OpenSpec task-board checkbox ratios are also not code percentages. A task
checkbox closes when its `T2-core` acceptance passes. Capability and release
certification stay in the matrices and do not hold implementation checkboxes
open. Stage 4 has 73 implementation-gating task checkboxes among 87 work
records; Stage 5 has 50 among 76; Stage 6 has 91 tasks with a core scope among
100 work records. The remaining task records are explicitly capability-only,
release-only, combined capability/release, or tracking-only.

## What is not code-complete

Stages 1–6 have no known missing in-scope core implementation. Their accepted
candidates passed the relevant automated, real-app MCP, restart, persistence,
native Windows, package, performance, and independent-review gates. Provider,
device, hardware, remote, VM, hosted-CI, signing, notarization, malware, and
packaged-release evidence is classified separately and is not evidence of
missing core code.

Stage 5 release certification still needs:

- a production publisher certificate/thumbprint and signed NSIS/portable
  artifacts;
- clean-VM install, upgrade, repair, rollback, and both uninstall choices;
- an exact hosted Windows CI run and artifact retention against the final
  source state; and
- any repair code exposed by those lifecycle runs.

The missing signing identity and unrun release environments are external
authority/evidence, not known implementation defects in the unsigned Preview
path. A failed acceptance run can still reopen Tier 1 if it exposes a defect.

Stage 6 release certification still needs the sixteen release-evidence rows in
[`stage6-full-feature-test-matrix.md`](stage6-full-feature-test-matrix.md),
including promoted native artifacts, signing/notarization, hosted CI, package
lifecycle, and public support review. Ten optional capability rows also remain
open for real devices/providers, assistive technology, Obsidian interop, and
long host observation.

## What is not AI-accepted

No `T2-core` row remains open in Stages 1 through 6. The accepted gates include
clean install coverage, strict OpenSpec validation, Node 22 lint, formatting,
TypeScript, native ABI validation, repository tests, production builds,
Stage 6 ledger validation, bounded performance checks, live app workflows, and
independent review. Exact historical counts remain in the stage ledgers and
local evidence instead of being copied into this status page.

Real-app evidence covered Stage 4 operational MCP flows, deterministic
orchestration, Runtime/Profile lifecycle and forced-restart persistence, and
the Stage 5 Windows deep-link, DPAPI, PowerShell/cmd PTY, scheduler, path,
security, usage-daemon, Preview package, binary-inspection, and package-audit
paths. Independent review found no remaining P0/P1 defect after the discovered
runtime-failure and cancellation-race defects were fixed and regression-tested.

Still uncertified are Stage 4's 12 optional provider/remote capability rows and
one macOS release row; Stage 5's 21 optional provider/device/environment rows
and 14 release rows; and Stage 6's 10 optional capability rows and 16 release
rows. They do not block core completion.

## Owner testing

The owner backlog contains concise feature instructions with detailed,
indented task checks. Leaving those Tier 3 boxes open records “not yet tested
by the owner”; it does not roll a Tier 2-complete feature back to incomplete.
