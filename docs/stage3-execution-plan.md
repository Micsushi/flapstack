# Stage 3 execution plan

Status: complete and historical. Stage 3 closed at 203/203 tasks and 48/48
integrated rows. The branch and lane instructions below document the completed
execution, not current work.

## Outcome

Deliver one runnable initial Stage 3 that combines production MCP control,
Settings reliability, migrated Stage 2 closeout, supporting fixes already
planned on `main`, full automated validation, live UI evidence, and honest
package/platform limitations.

## Work lanes

Each lane uses one Codex task and isolated worktree based on the latest
integration head. A lane commits only its owned scope. The coordinator rebases
or fast-forwards the lane before integration, runs focused checks, and merges
verified commits into the cumulative branch.

1. **MCP + permission integration — S3-F2 through S3-F6 and F12 edges**
   - Rebased migration compatibility, startup recovery, provider permission
     composition, one approval owner, queued-run identity, renderer refresh,
     production/dev MCP separation, visible fork lineage, named agent-task
     membership, durable bounded scheduling, budgets/stops, aggregate task UI,
     lifecycle controls, and focused integration/attack tests.
   - 2026-07-13 closeout lane: custom hierarchy/runtime enforcement and
     stale-ACP-session recovery are implemented. OpenRouter/NanoGPT headless
     smokes, the full Node 22 gate, and unsigned macOS Preview packaging pass.
     GPP-T4/T6/T9 closed in the `64d1` lane with verified live Codex,
     all-chat/current-chat, package, strict-spec, and full-gate evidence.
     S3-F12-T1 through T4 are closed; T5 remains open only for the integrated
     legacy-row visual check. Codex alone is promoted as exact project-only.
2. **Settings shell — S3-F7, S3-F8, S3-F13**
   - Honest visibility, keyboard registry/runtime parity, route/search/copy
     consistency, focused and live Settings verification.
3. **Voice + credentials — S3-F9, S3-F10**
   - Parakeet-first streaming, Whisper fallback, origin-safe composers, Voice
     History, canonical playback preferences, write-only secure credentials.
4. **Provider extensions + harness closeout — S3-F11, S3-F15**
   - Provider-scoped discovery/mutation/runtime consumption, Cursor/OpenCode
     lifecycle, OpenRouter/NanoGPT model/default repair, live/package evidence.
5. **Usage closeout — S3-F14**
   - Store/engine/daemon hardening, provider reconciliation, alerts/dashboard,
     closed-app and cross-platform evidence.
6. **Reasoning parity — S3-F16**
   - Capability/fallback fixtures, streaming/persistence/search parity, honest
     private/token-only states, live provider matrix.
7. **Supporting active changes**
   - Universal agent questions, undo/review, full-history copy, timestamps,
     model tuning, agent context/evidence, and canonical-conversation migration
     rows still open in their existing OpenSpec boards.
8. **Integrated release — S3-F17**
   - Starts after lanes 1-7 integrate. Owns full gate, clean-profile/live UI,
     restart/migration/package walkthroughs, final docs, and remaining limits.

## Dependencies

- MCP permission composition precedes final permission-mode promotion and
  cross-agent live proof.
- S3-F5 orchestration implementation waits on the completed spawn, permission,
  and audit cores; its live exit waits on task UI, restart/concurrency/budget
  evidence, renderer invalidation, and real two-way Codex/Claude proof.
- Secure credentials precede credentialed provider and closed-app daemon proof.
- Provider closeout precedes the complete live reasoning matrix.
- Voice, Usage, provider, reasoning, Settings, MCP, and supporting changes all
  block the S3-F17 release gate.
- A blocked lane is explicitly woken after its prerequisite integrates; tasks do
  not resume themselves.

## Coordinator loop

Every ten minutes while work remains:

1. Inspect worker task status, branch/worktree cleanliness, HEAD, and blockers.
2. Wake lanes whose prerequisite just landed; avoid duplicate wakeups.
3. Reject dirty, uncommitted, unverified, or stale integration requests.
4. Rebase a ready lane onto the latest integration head when needed.
5. Run its focused verification and strict OpenSpec validation.
6. Merge or cherry-pick the verified commits into `codex/stage3-integration`.
7. Run conflict-sensitive focused tests; update authoritative task checkboxes
   only when acceptance and verification both pass.
8. Stop launching duplicate heavy gates while another worker owns the repository
   heavy-job lock.
9. Before launching or controlling the live app, acquire the machine-wide UI
   lease with `npm run ui:lock -- <lane-name>`. Keep that command running while
   using Computer Use or other real UI controls, then press Ctrl-C to release
   it. The command waits when another lane owns the UI and clears dead owners.
   Use `npm run ui:lock:status` to inspect the current owner. Authenticated
   test-control MCP/API and other headless checks do not need the UI lease.

## Review and fix rounds

After implementation lanes finish, run up to three fresh review/fix rounds:

1. **Correctness + data:** migrations, persistence, recovery, concurrency,
   run identity, lifecycle, stale UI, and regression coverage.
2. **Security + control:** caller identity, permissions, approvals, secrets,
   worktree boundaries, self-reference, audit completeness, and MCP separation.
3. **UI + release:** Settings/chat workflows, accessibility, focus behavior,
   live dev identity, packaging, platform truth, docs/spec/task consistency.

Each review starts from the latest integration head. Actionable findings go to a
new fix task/worktree, then the relevant checks and review are rerun. Stop early
only when a round has no unresolved release-blocking finding.

## Final gate

- Node 22 `npm run check`.
- Strict validation for every active Stage 3 OpenSpec change.
- Database upgrade tests from fresh and supported prior schemas.
- `npm run dev`, final restart, then `npm run dev:verify` proving checkout and
  `Flapstack Dev` profile.
- Live MCP, permissions, Settings, Voice, Usage, providers, reasoning, and
  supporting-fix walkthroughs from `docs/stage3-full-feature-test-matrix.md`.
- macOS `npm run package:preview:mac`; Windows/Linux evidence passed or listed
  as remaining without implied parity.
- Clean `main`; all Stage 3 commits present on `codex/stage3-integration`.
