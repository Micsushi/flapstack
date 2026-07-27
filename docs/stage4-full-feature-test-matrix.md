# Stage 4 Full Feature Test Matrix

This is the Stage 4 Tier 2 AI-acceptance matrix. Required rows remain open until
an agent observes them against the stated build/profile. Headless tests do not
substitute for real app, product MCP, test-control MCP, provider, or packaged
evidence when those paths are relevant.

Owner-perspective testing lives in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md) and does not
hold these rows open unless explicitly labeled `release-blocking`. Rows labeled
tracking-only are not part of Stage 4 implementation completion.

This matrix is the promotion gate for the Stage 4 feature-code pass included in
the macOS-only `0.1.0` beta. Optional Beta Features default off; inclusion in the
candidate does not close an unchecked row.

## Evidence-class summary

Recorded baseline evidence is separated by class:

| Evidence class                           | Baseline recorded | Total |
| ---------------------------------------- | ----------------: | ----: |
| `T2-core`                                |                52 |    52 |
| `T2-capability:codex-v2`                 |                 0 |     1 |
| `T2-capability:codex-v1`                 |                 0 |     1 |
| `T2-capability:codex-runtime`            |                 0 |     2 |
| `T2-capability:claude-runtime`           |                 0 |     1 |
| `T2-capability:flapstack-native-runtime` |                 0 |     1 |
| `T2-capability:mixed-runtime-providers`  |                 0 |     2 |
| `T2-capability:ollama`                   |                 0 |     3 |
| `T2-capability:private-sync`             |                 0 |     1 |
| `release-gate`                           |                 0 |     1 |
| `tracking-only`                          |                 1 |     1 |

There are 65 acceptance checkboxes: 52 core, 12 capability, and one release
gate. S4-I04 is one additional non-checkbox tracking row. The former `5/65`
aggregate mixed implementation with unavailable capability environments. It is
not a valid Stage 4 completion percentage. Capability rows certify only their
named provider or environment and do not hold Stage 4 implementation completion
open. The packaged macOS row is a release gate, not an implementation gate.
The 52 core rows are accepted against the exact final working tree described
below. Capability and release rows remain independently uncertified.

## Automated Gate

- [x] **[T2-core] S4-A01** All eleven Stage 4 OpenSpec changes pass strict validation.
- [x] **[T2-core] S4-A02** Node 22 `npm run check` passes from the Stage 4 integration checkout.
- [x] **[T2-core] S4-A03** Migration fixtures pass from the last supported Stage 3 schema.
- [x] **[T2-core] S4-A04** Security tests cover path traversal, symlink escape, secrets,
      hook execution, budget bypass, stale identity, and cross-window ownership.

2026-07-26 automated evidence: all eleven Stage 4 changes passed strict
OpenSpec validation. The Windows Node 22 full gate passed lint, Prettier,
TypeScript, native ABI 127 loading, 313 test files (2,575 passed, 33 skipped,
3 files skipped; 2,608 tests total), and the production build. The passing suite includes the
ordered migration/rollback fixtures and the security boundaries named above.

## Unified Skills and Hooks

- [x] **[T2-core] S4-SH01** Inventory identifies source, scope, harness, native format,
      support level, and runtime-consumption state without false parity.
- [x] **[T2-core] S4-SH02** Copy/share previews the exact target diff and preserves the
      source; unsupported fields remain visible.
- [x] **[T2-core] S4-SH03** Hook import is disabled by default; validation and dry-run
      finish before explicit enablement.
- [x] **[T2-core] S4-SH04** User, project, and task enablement survive restart and affect
      the next supported harness run.

## Project Knowledge Vaults

- [x] **[T2-core] S4-KV01** Scaffold creates only the approved location and typed sections.
- [x] **[T2-core] S4-KV02** Secrets are rejected or quarantined and never injected into a
      run, search result preview, log, or MCP audit summary.
- [x] **[T2-core] S4-KV03** Selected sections enter run context; unselected sections do not.
- [x] **[T2-core] S4-KV04** Concurrent app/agent edits are detected and never overwritten
      silently.
- [x] **[T2-core] S4-KV05** Backup/export and restore preserve content and section metadata.

## Multi-Agent Operations

- [x] **[T2-core] S4-MA01** Fleet view lists active and terminal orchestrations without
      replaying completed work.
- [x] **[T2-core] S4-MA02** Lineage graph shows spawn and replacement edges and supports
      keyboard navigation to every live chat.
- [x] **[T2-core] S4-MA03** Tightened limits apply safely; unsafe relaxations require the
      existing approval/audit gate.
- [x] **[T2-core] S4-MA04** Pause, stop, and cascading cancellation reach all descendants
      and show partial failures honestly.
- [x] **[T2-core] S4-MA05** Restart preserves queue, budgets, lineage, stop reason, and
      cancellation intent.
- [x] **[T2-core] S4-MA06** Engine selection resolves per-launch, project, global, then
      `workflow` default; the stored engine snapshot cannot change mid-run and an
      unsupported native mode never falls back silently.
- [x] **[T2-core] S4-MA07** A deterministic workflow runs parallel and dependent phases,
      validates structured output, fails closed at required barriers, and resumes
      from durable checkpoints without replaying completed workers.
- [ ] **[T2-capability:codex-v2] S4-MA08** Codex V2 preserves named task paths, selective context forks,
      mailbox/follow-up/interrupt semantics, and reusable worker identity.
- [ ] **[T2-capability:codex-v1] S4-MA09** Codex V1 remains visibly legacy and preserves ID-based
      spawn/send/wait/resume/close behavior without synthetic V2 features.
- [ ] **[T2-capability:mixed-runtime-providers] S4-MA10** Mixed-runtime workflow activity preserves agent/run/runtime
      provenance and adds ordered workflow, mailbox, dependency, spawn, warning,
      and usage events without copying or relabeling provider reasoning.

Supporting evidence for S4-MA01 through S4-MA10 is recorded in
`docs/stage4-s4-f3-multi-agent-operations.md`. The exact-tree campaign added the
real-app workflow, restart, roster, cancellation, and durable-activity proof
needed to accept S4-MA01 through S4-MA07. Direct Codex transports and mixed
providers remain separately scoped capability rows.

## Saved Workspaces

- [x] **[T2-core] S4-WS01** Create, rename, archive, restore, and delete behave locally and
      survive restart.
- [x] **[T2-core] S4-WS02** Up to four chat panes render at once; overflow uses tabs or
      another window without restoring nested chat UI.
- [x] **[T2-core] S4-WS03** Terminal, worktree, diff, file/editor, and browser bindings
      restore or show an explicit stale/missing state.
- [x] **[T2-core] S4-WS04** A chat cannot be controlled by two windows; focus/open-here
      recovery is explicit.
- [x] **[T2-core] S4-WS05** Layout writes are crash-safe and invalid panes do not prevent
      the rest of a workspace from opening.
- [x] **[T2-core] S4-WS06** Starting an orchestration creates one operation workspace; all
      descendant chats join its roster once, overflow stays bounded, restart
      repairs the link without replay, and workspace deletion preserves work.
      Earlier partial evidence covered the atomic creation and startup repair
      contracts. The final exact-tree real-app workflow and forced-restart proof
      closed the roster, no-replay, durable deletion, and identity requirements.

## Automation and Scheduler

- [x] **[T2-core] S4-AU01** Schedule and event triggers survive restart without duplicate runs.
- [x] **[T2-core] S4-AU02** Agent-created automation remains inactive until approved and audited.
- [x] **[T2-core] S4-AU03** Dry-run performs no mutation; retry, budget, and kill behavior stay visible.

## Local Models

- [ ] **[T2-capability:ollama] S4-LM01** Local discovery and streaming work without hosted auth.
  - Automated evidence: catalog/stream/router/Runtime tests cover loopback-only
    discovery, normalized streaming, exact model identity, bounded cancellation,
    restart no-replay, diagnostics, and explicit no-cloud-fallback preflight.
    Real installed-model and packaged evidence remains open.
- [ ] **[T2-capability:ollama] S4-LM02** Read-only local runs produce normal run, checkpoint, manifest,
      usage, and model identity records.
  - Automated evidence: local run tests cover durable messages/runs, checkpoints,
    manifests, provider-reported or unknown token capture, exact zero provider
    billing with unmeasured compute provenance, workspace model restore, and
    orchestration result aggregation. Real provider/package evidence remains open.
- [ ] **[T2-capability:ollama] S4-LM03** Write and shell stay unavailable until their permission tiers pass.
  - Automated evidence: read/write/exec and orchestration preflight tests cover
    traversal, symlink races, approvals, independent shell/git/network policy,
    capability mismatch, unknown-tool denial, and durable-definition corruption
    before claim/launch with terminal audit projection and no cloud fallback.
    Real chat-only/tool-capable model and packaged permission walkthroughs remain
    open.

## Advanced Usage and Limits

- [x] **[T2-core] S4-UL01** Run/chat/task/project/account/harness rollups reconcile to raw samples.
- [x] **[T2-core] S4-UL02** Exact, provider-reported, estimated, and unknown values remain distinct.
- [x] **[T2-core] S4-UL03** Thresholds and alerts survive app closure through the local daemon.

## Import, Export, and Private Sync

- [x] **[T2-core] S4-IE01** Export carries schema version, selected scopes, and no secrets.
  - Evidence: Node 22 contract/secret/export tests pass relational one-project parent/dependent filtering, deterministic bundles, source-path exclusion, checksums, concurrent writes, cancellation cleanup, shared AWS/Google/provider-family detection, structured AWS exclusion, and no secret/WAL/SHM output. Exact-tree live portability exercises passed; packaged release certification is separate.
- [x] **[T2-core] S4-IE02** Import previews changes and conflicts before writing or migrating.
  - Evidence: Node 22 plan/apply tests pass strict plan/journal parsing, canonical target/resolution confirmation, mapping-edit invalidation, mapped empty-profile extension/vault restore, redacted conflict values, actual preserve-both artifacts, app-wide maintenance gating, apply/rollback symlink-swap refusal, stale refusal, five fault windows, locked retry, FK order/check/rollback, and manual restore. Exact-tree live portability exercises passed; owner UI walkthrough remains Tier 3.
- [ ] **[T2-capability:private-sync] S4-IE03** Optional private sync uses only a user-owned remote and handles conflicts honestly.
  - Automated evidence: Node 22 local-bare-remote tests pass isolated-index commit-tree/CAS enforcement under concurrent HEAD movement, exact reviewed OID/path/blob enforcement, unapproved incoming/outgoing rejection, bare AWS/Google and committed-secret refusal, exact-OID pull, stale-remote push refusal, config/origin/branch hardening, dirty stop, and unlink preservation. Real private-remote, consolidated live UI, and package proof remain open. The configured `Micsushi/flapstack` remote is currently public, so it cannot certify this private-remote capability.

## Plan and Kanban

- [x] **[T2-core] S4-PK01** Plan view distinguishes proposed, active, and built work.
  - Evidence: Node 22 F9 gate passes source discovery,
    parsing, stale/malformed recovery, read-only hierarchy/filter rendering, and
    production Plan route coverage; exact-tree real-app planning exercises and
    automated accessibility coverage passed.
- [x] **[T2-core] S4-PK02** Moving an approved card to In Progress creates one real task and
      one seeded scoped chat without launching a run.
  - Evidence: Node 22 F9 gate passes durable task-card
    mapping, promotion idempotency/rollback/no-run, versioned reorder, stale
    move, and renderer invalidation coverage. Exact-tree real-app promotion
    exercises passed; the owner multi-window walkthrough remains Tier 3.
- [x] **[T2-core] S4-PK03** AI-proposed cards remain inert until approved in the board UI.
  - Evidence: Node 22 F9 gate passes proposal inertness,
    exact-preview approval, denial, capped batch, audit, no-run, conflict, and
    production Tasks route coverage. Exact-tree real-app planning exercises and
    automated accessibility coverage passed.

## Agent Runtimes

- [x] **[T2-core] S4-AR01** Runtime resolution follows chat, project-per-harness,
      global-per-harness, then product mapping and snapshots one immutable
      runtime/adapter version before every run.
  - Automated evidence: ordered migration, reopen, rollback, immutable
    snapshot, activity, and frozen Stage 3 fixture suites pass.
- [x] **[T2-core] S4-AR02** Compatibility is harness-based: Codex and Claude Code may use
      their native runtime or Flapstack Native; generic providers may use only
      Flapstack Native; unavailable choices never silently fall back.
  - Automated evidence: resolver, run-creation, Settings, registry, and router
    guard suites pass.
- [ ] **[T2-capability:codex-runtime] S4-AR03** Codex runtime preserves thread, turn, item, summary/content
      indices, section boundaries, plans, tools, permissions, usage, warnings,
      cancellation, and recovery from direct App Server events.
  - Evidence: fixtures and pinned macOS package smoke pass. Credentialed
    current-source live acceptance remains open.
- [ ] **[T2-capability:codex-runtime] S4-AR04** Codex private/encrypted reasoning never renders; provider
      summaries and explicitly displayable text keep honest labels and ordering.
  - Automated evidence: private-reasoning filtering and displayable-summary
    ordering suites pass.
- [ ] **[T2-capability:claude-runtime] S4-AR05** Claude Code runtime preserves SDK content blocks, session and
      message identity, thinking, tools, permissions, hooks, usage, and child
      provenance without representing thinking as a tool.
  - Evidence: fixtures and pinned macOS package smoke pass. Credentialed live
    acceptance remains open.
- [x] **[T2-core] S4-AR06** Thinking effort, reasoning display, subagent activity, and hook
      diagnostics work independently for every supported combination.
  - Automated evidence: durable activity ordering, pagination, replay, privacy,
    corruption, restart, and multi-window invalidation suites pass.
- [ ] **[T2-capability:flapstack-native-runtime] S4-AR07** Flapstack Native passes the complete Stage 3 provider/reasoning
      fixture suite and opens legacy history without rewriting messages.
  - Evidence: automated provider and legacy-history suites plus macOS package
    smoke pass; consolidated live acceptance remains open.
- [x] **[T2-core] S4-AR08** An empty chat changes runtime in place; a started chat uses one
      new Continue-with-runtime chat/session; an active run cannot switch.
  - Automated evidence: Settings, mutation, active-run blocking, exact-once
    continuation, retry, undo, restart, and diagnostics suites pass.
- [ ] **[T2-capability:mixed-runtime-providers] S4-AR09** Codex, Claude Code, and Flapstack Native agents coexist in one
      workflow while Flapstack permissions, worktrees, audit, and run status
      remain authoritative.
  - Automated evidence: production-authority, registry, provider-neutral
    coordination, recovery, cancellation, and mixed-worker suites pass.
- [x] **[T2-core] S4-AR10** Activity persistence survives restart, deduplicates retries,
      remains responsive at 10k events, passes accessibility, and rolls back
      without deleting history.
  - Evidence: the 10,000-event budget, automated accessibility checks, exact-tree
    activity retry deduplication, and forced live restart proof pass.
    Provider-specific runtime evidence is owned by S4-AR03 through S4-AR09;
    package evidence is owned by the applicable package or release matrix.

## Agent Profiles and Personalities

Current compatibility boundary: new profiles and starters default to Claude
Code. Codex-backed profile previews fail closed before confirmation because the
Codex Runtime does not expose exact enforcement for no-approval tools. Existing
immutable Codex profile versions/snapshots remain historical. This limits the
Codex profile capability claim; it does not hold the provider-neutral profile
contracts open.

- [x] **[T2-core] S4-AP01** Capability, personality, workflow binding, and runtime snapshot
      remain separate; changing tone cannot widen tools, permissions, memory,
      descendants, model ceiling, runtime, or worktree authority.
- [x] **[T2-core] S4-AP02** A user creates, versions, duplicates, searches, archives, and
      restores a named profile while active and historical agents retain their
      immutable resolved snapshots.
- [x] **[T2-core] S4-AP03** Resolved preview shows the source of every field, compatibility,
      requested authority, and exact conflicts; inheritance cycles and silent
      runtime/model fallback fail closed.
- [x] **[T2-core] S4-AP04** One deterministic workflow binds exact profile versions to
      parallel and dependent steps, resumes from checkpoints with the same
      snapshots, and offers an explicit fork/retry for updated profiles.
- [x] **[T2-core] S4-AP05** Starting a standalone named agent from a task/chat/Profile
      Studio creates exactly one durable chat/run, preserves selected context and
      authority, joins the operation workspace when applicable, and survives restart.
- [x] **[T2-core] S4-AP06** Profile import/export is versioned and secret-free; missing or
      untrusted skills, hooks, MCP, memory, tools, and runtimes remain disabled
      until their normal approval/compatibility paths succeed.
- [x] **[T2-core] S4-AP07** Every built-in starter type has versioned capability, safety,
      prompt-injection, and supported runtime/model evidence; user edits create
      an independent copy and untested combinations are labeled honestly.
- [x] **[T2-core] S4-AP08** Profile Studio keeps capability and personality
      semantically separate; automated accessibility checks cover accessible
      names/states, focus order, keyboard-operable controls, errors, and the
      create, preview, workflow-bind, standalone-launch, duplicate, import,
      export, and archive flows.
  - The owner's keyboard, screen-reader, and visual walkthrough is Tier 3 and
    remains in the separate manual backlog.

The Node 22 implementation packet covers migration, typed contracts,
lifecycle/import trust, immutable resolution, workflow and standalone dispatch,
starter evaluation, Profile Studio, task/chat actions, diagnostics, and
focused acceptance tests. Exact-tree authenticated MCP covered profile
CRUD/versioning, preview, workflow/standalone dispatch, retry/update behavior,
and forced restart. Automated semantic/accessibility acceptance passed for
S4-AP08. Provider, packaged-preview, and cross-device claims remain separate;
the owner keyboard/screen-reader walkthrough remains Tier 3. See
`docs/agent-profiles.md`.

## Integrated Live and Package Gate

- [x] **[T2-core] S4-I01** `npm run dev:verify` identifies this checkout and the
      `Flapstack Dev` profile after the final restart.
- [x] **[T2-core] S4-I02** One project workflow exercises the Stage 4 core across
      knowledge, extensions, orchestration, workspaces, automation, usage,
      export/import, planning, runtime selection, and reusable
      workflow/standalone agent profiles. Optional provider and remote
      capabilities are certified by their own rows.
- [ ] **[release-gate] S4-I03** `npm run package:preview:mac` opens the preview profile and the
      same workflow passes without development-only paths.
  - Earlier packaging, arm64 binary inspection, and packaged smoke passed. Opening the
    preview UI/workflow remains open because the Mac session was locked.
- **[tracking-only] S4-I04:** Windows evidence belongs to Stage 5 and Linux
  evidence remains future platform work; neither blocks Stage 4 Tier 2 exit.

## 2026-07-26 exact-tree Tier 2 evidence

- Strict OpenSpec validation passed 54/54 across the repository. Node 22
  `npm run check` passed lint, formatting, TypeScript, native ABI validation,
  313 test files with 2,575 tests passed and 33 skipped (2,608 total), and the
  production build.
- Authenticated real-app MCP exercises covered skills and hooks, knowledge
  vaults, saved and operation workspaces, automation dry-runs, local-model
  discovery fixtures, usage/limits, portability, and Plan/Kanban flows.
- Deterministic orchestration exercised parallel/dependent phases, frozen
  bindings, one operation-workspace roster, checkpoint/restart recovery, durable
  activity, cancellation, retry deduplication, and zero unintended provider
  launches.
- Runtime and Profile exercises covered empty and continued chats, immutable
  runtime/profile snapshots, create/version/search/archive/restore,
  export/import/update/resolve/duplicate, standalone preview/follow-up/retry,
  workflow bindings, forced restart, and persisted workspace/activity identity.
- Automated semantic/accessibility coverage passed for Profile Studio and the
  relevant controls. Owner keyboard, screen-reader, and visual walkthroughs
  remain Tier 3.
- Independent review found no remaining P0/P1 defect after the identified
  runtime failure and cancellation-race defects were fixed and their focused
  regression suites passed.

Stage 4 is implementation complete at Tier 2: all 52 `T2-core` rows are
accepted. The 12 optional provider/remote capability rows and the macOS package
release row remain separately uncertified and do not block Stage 4
implementation completion.
