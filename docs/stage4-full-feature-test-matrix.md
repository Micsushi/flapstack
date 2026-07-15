# Stage 4 Full Feature Test Matrix

All rows remain open until observed against the stated build/profile. Headless
tests do not substitute for live UI or packaged evidence.

## Automated Gate

- [ ] **S4-A01** Every Stage 4 OpenSpec change passes strict validation.
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

## Automation and Scheduler

- [ ] **S4-AU01** Schedule and event triggers survive restart without duplicate runs.
- [ ] **S4-AU02** Agent-created automation remains inactive until approved and audited.
- [ ] **S4-AU03** Dry-run performs no mutation; retry, budget, and kill behavior stay visible.

## Local Models

- [ ] **S4-LM01** Local discovery and streaming work without hosted auth.
- [ ] **S4-LM02** Read-only local runs produce normal run, checkpoint, manifest,
      usage, and model identity records.
- [ ] **S4-LM03** Write and shell stay unavailable until their permission tiers pass.

## Advanced Usage and Limits

- [ ] **S4-UL01** Run/chat/task/project/account/harness rollups reconcile to raw samples.
- [ ] **S4-UL02** Exact, provider-reported, estimated, and unknown values remain distinct.
- [ ] **S4-UL03** Thresholds and alerts survive app closure through the local daemon.

## Import, Export, and Private Sync

- [ ] **S4-IE01** Export carries schema version, selected scopes, and no secrets.
- [ ] **S4-IE02** Import previews changes and conflicts before writing or migrating.
- [ ] **S4-IE03** Optional private sync uses only a user-owned remote and handles conflicts honestly.

## Plan and Kanban

- [ ] **S4-PK01** Plan view distinguishes proposed, active, and built work.
- [ ] **S4-PK02** Moving an approved card to In Progress creates one real task and
      one seeded scoped chat without launching a run.
- [ ] **S4-PK03** AI-proposed cards remain inert until approved in the board UI.

## Cross-Agent Mobile Companion

- [ ] **S4-MC01** Pairing, revocation, reconnect, and device identity fail closed.
- [ ] **S4-MC02** Mobile can monitor and steer only Flapstack-launched supported runs.
- [ ] **S4-MC03** Approval cards show project, task, worktree, action, and risk;
      remote mutation requires explicit revocable authority.

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
- [ ] **S4-I02** One project workflow exercises all ten Stage 4 features across
      knowledge, extensions, orchestration, workspaces, automation, local models,
      usage, export, planning, and mobile control.
- [ ] **S4-I03** `npm run package:preview:mac` opens the preview profile and the
      same workflow passes without development-only paths.
  - Packaging, arm64 binary inspection, and packaged smoke passed. Opening the
    preview UI/workflow remains open because the Mac session was locked.
- [ ] **S4-I04** Windows and Linux package rows remain open until actually
      observed on those platforms.
