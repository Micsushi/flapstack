## Context

Stage 3 runs in a long-lived integration branch with multiple feature changes.
It includes Electron main/renderer state, SQLite migrations, native/package
resources, CLIs, provider APIs, OS credentials/services, and two MCP surfaces:
production safe control and dev-only test control. Release evidence must bind
these layers to one exact checkout and profile.

## Goals / Non-Goals

- Goals: one release manifest, dependency-complete automated and manual
  evidence, isolated profiles/data, clean recovery, independent review, truthful
  docs/tasks, and archive readiness.
- Non-goals: squash-merge to `main`, publish a production release, waive missing
  platform/provider evidence, or redesign features unrelated to found defects.

## Decisions

- Freeze one candidate SHA per release attempt. Any product/test/spec change
  invalidates affected evidence and creates a new candidate SHA.
- Keep `main` untouched. Test from the Stage 3 integration checkout using
  `Flapstack Dev` for live development and `Flapstack Preview` for packaged
  macOS preview; record equivalent exact identities on other platforms.
- Use disposable repositories, worktrees, credentials, webhooks, data profiles,
  services, and MCP exposure. Never reuse production user data for destructive
  cases.
- S3-F6-T4 closes MCP behavior; S3-F13-T4 closes Settings promotion; S3-F17
  consumes their evidence and owns cross-feature release/archival truth.
- Build one row ledger with PASS, FAIL, BLOCKED, or NOT RUN. Only PASS satisfies
  a required gate. Every row records exact SHA, environment, IDs, artifacts,
  and cleanup.
- Review the candidate independently after integration. A fix triggers targeted
  reruns plus the full release gate. Run at most three planned review/fix rounds;
  unresolved required findings block release rather than silently ending review.
- Archive active changes only when their own tasks/specs and the integrated
  ledger agree. Do not archive to manufacture a clean board.

## Verification Layers

1. Static truth: task/router/spec/doc links, status, dependency graph, and strict
   OpenSpec validation.
2. Automated: Node 22 `npm run check`, focused security/concurrency/migration
   suites, MCP SDK/proxy smoke, daemon smoke, and package inspection.
3. Live dev: verified checkout/profile, real provider runs, approvals/audit,
   cross-agent spawning, Usage, reasoning, Voice, Settings, restart/recovery.
4. Packaged preview/platform: executable/profile/resources, secure storage,
   daemon/service, CLI/sidecar/STT resources, upgrade/restart, cleanup.
5. Independent review: code/spec/security/reliability review, fixes, reruns, and
   residual-risk decision.

## Risks / Trade-offs

- A broad matrix is expensive. Reuse exact evidence only when SHA and affected
  code paths remain unchanged; never reuse stale evidence across a relevant fix.
- Some providers/platforms require external access. Required missing evidence is
  a blocker; conditional gaps remain explicit release limitations.

## Rollback and Cleanup

Each test row names reversal steps. Stop dev/preview processes, disable/remove
test services and MCP exposure, revoke disposable credentials/webhooks, remove
isolated data only after evidence capture, and leave `main` unchanged.
