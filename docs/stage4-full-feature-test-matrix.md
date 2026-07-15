# Stage 4 Full Feature Test Matrix

All rows remain open until observed against the stated build/profile. Headless
tests do not substitute for live UI or packaged evidence.

## Automated Gate

- [ ] **S4-A01** All eleven Stage 4 OpenSpec changes pass strict validation.
- [ ] **S4-A02** Node 22 `npm run check` passes from the Stage 4 integration checkout.
- [ ] **S4-A03** Migration fixtures pass from the last supported Stage 3 schema.
- [ ] **S4-A04** Security tests cover path traversal, symlink escape, secrets,
      hook execution, budget bypass, stale identity, and cross-window ownership.

## Unified Skills and Hooks

- [ ] **S4-SH01** Inventory identifies source, scope, harness, native format,
      support level, and runtime-consumption state without false parity.
- [ ] **S4-SH02** Copy/share previews the exact target diff and preserves the
      source; unsupported fields remain visible.
- [ ] **S4-SH03** Hook import is disabled by default; validation and dry-run
      finish before explicit enablement.
- [ ] **S4-SH04** User, project, and task enablement survive restart and affect
      the next supported harness run.

## Project Knowledge Vaults

- [ ] **S4-KV01** Scaffold creates only the approved location and typed sections.
- [ ] **S4-KV02** Secrets are rejected or quarantined and never injected into a
      run, search result preview, log, or MCP audit summary.
- [ ] **S4-KV03** Selected sections enter run context; unselected sections do not.
- [ ] **S4-KV04** Concurrent app/agent edits are detected and never overwritten
      silently.
- [ ] **S4-KV05** Backup/export and restore preserve content and section metadata.

## Multi-Agent Operations

- [ ] **S4-MA01** Fleet view lists active and terminal orchestrations without
      replaying completed work.
- [ ] **S4-MA02** Lineage graph shows spawn and replacement edges and supports
      keyboard navigation to every live chat.
- [ ] **S4-MA03** Tightened limits apply safely; unsafe relaxations require the
      existing approval/audit gate.
- [ ] **S4-MA04** Pause, stop, and cascading cancellation reach all descendants
      and show partial failures honestly.
- [ ] **S4-MA05** Restart preserves queue, budgets, lineage, stop reason, and
      cancellation intent.
- [ ] **S4-MA06** Engine selection resolves per-launch, project, global, then
      `workflow` default; the stored engine snapshot cannot change mid-run and an
      unsupported native mode never falls back silently.
- [ ] **S4-MA07** A deterministic workflow runs parallel and dependent phases,
      validates structured output, fails closed at required barriers, and resumes
      from durable checkpoints without replaying completed workers.
- [ ] **S4-MA08** Codex V2 preserves named task paths, selective context forks,
      mailbox/follow-up/interrupt semantics, and reusable worker identity.
- [ ] **S4-MA09** Codex V1 remains visibly legacy and preserves ID-based
      spawn/send/wait/resume/close behavior without synthetic V2 features.
- [ ] **S4-MA10** Mixed-runtime workflow activity preserves agent/run/runtime
      provenance and adds ordered workflow, mailbox, dependency, spawn, warning,
      and usage events without copying or relabeling provider reasoning.

Code-ready evidence for S4-MA01 through S4-MA10 is recorded in
`docs/stage4-s4-f3-multi-agent-operations.md`. Rows remain open until the F4/F11
dependencies and consolidated live/package walkthrough pass.

## Saved Workspaces

- [ ] **S4-WS01** Create, rename, archive, restore, and delete behave locally and
      survive restart.
- [ ] **S4-WS02** Up to four chat panes render at once; overflow uses tabs or
      another window without restoring nested chat UI.
- [ ] **S4-WS03** Terminal, worktree, diff, file/editor, and browser bindings
      restore or show an explicit stale/missing state.
- [ ] **S4-WS04** A chat cannot be controlled by two windows; focus/open-here
      recovery is explicit.
- [ ] **S4-WS05** Layout writes are crash-safe and invalid panes do not prevent
      the rest of a workspace from opening.
- [ ] **S4-WS06** Starting an orchestration creates one operation workspace; all
      descendant chats join its roster once, overflow stays bounded, restart
      repairs the link without replay, and workspace deletion preserves work.
2026-07-14 partial S4-WS06 evidence: the reviewed F3 creation transaction now
creates the operation-workspace metadata atomically, and startup reconciliation
repairs missing metadata without replay. The bounded membership, archived
read-only, and identity review brings Node 22 affected coverage to 42/42. The
row stays open for the complete F3 Runtime path and live restart/roster proof.
Explicit operation-workspace deletion now persists across startup reconciliation
until the user regenerates the same opaque identity. The bounded delete,
duplicate, and archived-file slice passes 16/16; no broad gate was repeated.

## Automation and Scheduler

- [ ] **S4-AU01** Schedule and event triggers survive restart without duplicate runs.
- [ ] **S4-AU02** Agent-created automation remains inactive until approved and audited.
- [ ] **S4-AU03** Dry-run performs no mutation; retry, budget, and kill behavior stay visible.

## Local Models

- [ ] **S4-LM01** Local discovery and streaming work without hosted auth.
  - Automated evidence: catalog/stream/router/Runtime tests cover loopback-only
    discovery, normalized streaming, exact model identity, bounded cancellation,
    restart no-replay, diagnostics, and explicit no-cloud-fallback preflight.
    Real installed-model and packaged evidence remains open.
- [ ] **S4-LM02** Read-only local runs produce normal run, checkpoint, manifest,
      usage, and model identity records.
  - Automated evidence: local run tests cover durable messages/runs, checkpoints,
    manifests, provider-reported or unknown token capture, exact zero provider
    billing with unmeasured compute provenance, workspace model restore, and
    orchestration result aggregation. Real provider/package evidence remains open.
- [ ] **S4-LM03** Write and shell stay unavailable until their permission tiers pass.
  - Automated evidence: read/write/exec and orchestration preflight tests cover
    traversal, symlink races, approvals, independent shell/git/network policy,
    capability mismatch, unknown-tool denial, and durable-definition corruption
    before claim/launch with terminal audit projection and no cloud fallback.
    Real chat-only/tool-capable model and packaged permission walkthroughs remain
    open.

## Advanced Usage and Limits

- [ ] **S4-UL01** Run/chat/task/project/account/harness rollups reconcile to raw samples.
- [ ] **S4-UL02** Exact, provider-reported, estimated, and unknown values remain distinct.
- [ ] **S4-UL03** Thresholds and alerts survive app closure through the local daemon.

## Import, Export, and Private Sync

- [ ] **S4-IE01** Export carries schema version, selected scopes, and no secrets.
  - Automated evidence: Node 22 contract/secret/export tests pass relational one-project parent/dependent filtering, deterministic bundles, source-path exclusion, checksums, concurrent writes, cancellation cleanup, shared AWS/Google/provider-family detection, structured AWS exclusion, and no secret/WAL/SHM output. Live packaged proof remains open.
- [ ] **S4-IE02** Import previews changes and conflicts before writing or migrating.
  - Automated evidence: Node 22 plan/apply tests pass strict plan/journal parsing, canonical target/resolution confirmation, mapping-edit invalidation, mapped empty-profile extension/vault restore, redacted conflict values, actual preserve-both artifacts, app-wide maintenance gating, apply/rollback symlink-swap refusal, stale refusal, five fault windows, locked retry, FK order/check/rollback, and manual restore. Real clean-profile/package and unlocked UI walkthrough remain open.
- [ ] **S4-IE03** Optional private sync uses only a user-owned remote and handles conflicts honestly.
  - Automated evidence: Node 22 local-bare-remote tests pass isolated-index commit-tree/CAS enforcement under concurrent HEAD movement, exact reviewed OID/path/blob enforcement, unapproved incoming/outgoing rejection, bare AWS/Google and committed-secret refusal, exact-OID pull, stale-remote push refusal, config/origin/branch hardening, dirty stop, and unlink preservation. Real private-remote, consolidated live UI, and package proof remain open.

## Plan and Kanban

- [ ] **S4-PK01** Plan view distinguishes proposed, active, and built work.
- [ ] **S4-PK02** Moving an approved card to In Progress creates one real task and
      one seeded scoped chat without launching a run.
- [ ] **S4-PK03** AI-proposed cards remain inert until approved in the board UI.

## Agent Runtimes

- [ ] **S4-AR01** Runtime resolution follows chat, project-per-harness,
      global-per-harness, then product mapping and snapshots one immutable
      runtime/adapter version before every run.
- [ ] **S4-AR02** Compatibility is harness-based: Codex and Claude Code may use
      their native runtime or Flapstack Native; generic providers may use only
      Flapstack Native; unavailable choices never silently fall back.
- [ ] **S4-AR03** Codex runtime preserves thread, turn, item, summary/content
      indices, section boundaries, plans, tools, permissions, usage, warnings,
      cancellation, and recovery from direct App Server events.
- [ ] **S4-AR04** Codex private/encrypted reasoning never renders; provider
      summaries and explicitly displayable text keep honest labels and ordering.
- [ ] **S4-AR05** Claude Code runtime preserves SDK content blocks, session and
      message identity, thinking, tools, permissions, hooks, usage, and child
      provenance without representing thinking as a tool.
- [ ] **S4-AR06** Thinking effort, reasoning display, subagent activity, and hook
      diagnostics work independently for every supported combination.
- [ ] **S4-AR07** Flapstack Native passes the complete Stage 3 provider/reasoning
      fixture suite and opens legacy history without rewriting messages.
- [ ] **S4-AR08** An empty chat changes runtime in place; a started chat uses one
      new Continue-with-runtime chat/session; an active run cannot switch.
- [ ] **S4-AR09** Codex, Claude Code, and Flapstack Native agents coexist in one
      workflow while Flapstack permissions, worktrees, audit, and run status
      remain authoritative.
- [ ] **S4-AR10** Activity persistence survives restart, deduplicates retries,
      remains responsive at 10k events, passes accessibility, and rolls back to
      Flapstack Native without deleting history.

## Agent Profiles and Personalities

- [ ] **S4-AP01** Capability, personality, workflow binding, and runtime snapshot
      remain separate; changing tone cannot widen tools, permissions, memory,
      descendants, model ceiling, runtime, or worktree authority.
- [ ] **S4-AP02** A user creates, versions, duplicates, searches, archives, and
      restores a named profile while active and historical agents retain their
      immutable resolved snapshots.
- [ ] **S4-AP03** Resolved preview shows the source of every field, compatibility,
      requested authority, and exact conflicts; inheritance cycles and silent
      runtime/model fallback fail closed.
- [ ] **S4-AP04** One deterministic workflow binds exact profile versions to
      parallel and dependent steps, resumes from checkpoints with the same
      snapshots, and offers an explicit fork/retry for updated profiles.
- [ ] **S4-AP05** Starting a standalone named agent from a task/chat/Profile
      Studio creates exactly one durable chat/run, preserves selected context and
      authority, joins the operation workspace when applicable, and survives restart.
- [ ] **S4-AP06** Profile import/export is versioned and secret-free; missing or
      untrusted skills, hooks, MCP, memory, tools, and runtimes remain disabled
      until their normal approval/compatibility paths succeed.
- [ ] **S4-AP07** Every built-in starter type has versioned capability, safety,
      prompt-injection, and supported runtime/model evidence; user edits create
      an independent copy and untested combinations are labeled honestly.
- [ ] **S4-AP08** Profile Studio keeps capability and personality visually
      separate and completes create, preview, workflow-bind, standalone-launch,
      duplicate, import, export, and archive flows with keyboard/screen-reader use.

## Agent Runtimes

Automated closeout on Node 22: `npm run check` passed full lint, repository
formatting, TypeScript, 206 test files/1,611 tests with 3 skips, and production
main/preload/renderer builds. Strict OpenSpec validation passed. These results
do not close the live/provider/package rows below.

- [ ] **S4-AR01** Stage 3 migration and rollback preserve messages, sessions,
      snapshots, checkpoints, usage, audit, and legacy rendering.
  - Automated: pass — ordered 0032/0033 migration, reopen, rollback, immutable
    snapshot, activity, and frozen Stage 3 fixtures.
- [ ] **S4-AR02** Resolver precedence and compatibility match Settings, New Chat,
      direct, MCP, retry, and orchestration launch inputs without silent fallback.
  - Automated: pass — resolver/run-creation/Settings/registry/router-guard suites.
- [ ] **S4-AR03** Direct Codex fixture/live runs preserve displayable native event
      identity, ordering, sections, permissions, usage, lifecycle, and recovery.
  - Fixture and pinned macOS package smoke: pass. Credentialed live: open —
    installed `0.144.2` does not match pinned `0.144.1`; the adapter fails closed.
- [ ] **S4-AR04** Claude Code fixture/live runs preserve message, tool, hook,
      subagent, usage, provider-visible thinking, session, and recovery semantics.
  - Fixture and pinned macOS package smoke: pass. Credentialed live: open.
- [ ] **S4-AR05** Flapstack Native preserves the Stage 3 provider pipeline for
      every harness and remains an explicit rollback choice.
  - Automated and macOS package smoke: pass. Consolidated live walkthrough: open.
- [ ] **S4-AR06** Durable activity is ordered, paginated, replayable, private-safe,
      corruption-aware, and stable across restart/window invalidation.
  - Automated: pass, including 10,000 durable events and multi-window invalidation.
- [ ] **S4-AR07** Shared transcript formatting, search, copy, export, keyboard,
      screen-reader, streaming, and 10,000-event budgets pass.
  - Automated: pass — 10,000-event headless budget 244 ms/1,500 ms. Dev launch
    and exact checkout/profile verification passed; live visual comparison is
    open because the Mac session was locked.
- [ ] **S4-AR08** Settings, empty-chat mutation, active-run blocking, exact-once
      continuation, retry, undo, restart, and privacy-safe diagnostics pass.
  - Automated: pass. Live Settings/continue/reopen/multi-window walkthrough: open.
- [ ] **S4-AR09** Registry dispatch proves three adapters and mixed Runtime workers
      under one provider-neutral coordination contract without widened authority.
  - Automated production authority and fake-adapter/mixed-worker contract: pass.
    One database-profile service owns registry/coordinator, concrete disabled
    recovery factories, durable run-id reconciliation/cancellation, and all
    queued launch call sites. Credentialed direct dispatch remains open; direct
    release flags remain disabled.
- [ ] **S4-AR10** Credentialed direct/continue/restart/mixed-worker walkthroughs
      and packaged macOS smoke pass; Windows/Linux remain open until observed.
  - Package: pass — arm64 binary inspection/smoke reported Codex `0.144.1`, Claude
    `2.1.207`, and Electron `39.8.10`; speech sidecars passed. Credentialed UI,
    Windows, and Linux remain open because the Mac session was locked and those
    environments were not observed.

## Integrated Live and Package Gate

- [x] **S4-I01** `npm run dev:verify` identifies this checkout and the
      `Flapstack Dev` profile after the final restart.
- [ ] **S4-I02** One project workflow exercises all eleven Stage 4 features across
      knowledge, extensions, orchestration, workspaces, automation, local models,
      usage, export, planning, native agent runtimes, and reusable
      workflow/standalone agent profiles.
- [ ] **S4-I03** `npm run package:preview:mac` opens the preview profile and the
      same workflow passes without development-only paths.
  - Packaging, arm64 binary inspection, and packaged smoke passed. Opening the
    preview UI/workflow remains open because the Mac session was locked.
- [ ] **S4-I04** Windows and Linux package rows remain open until actually
      observed on those platforms.
