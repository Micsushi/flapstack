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

## Integrated Live and Package Gate

- [ ] **S4-I01** `npm run dev:verify` identifies this checkout and the
      `Flapstack Dev` profile after the final restart.
- [ ] **S4-I02** One project workflow exercises all eleven Stage 4 features across
      knowledge, extensions, orchestration, workspaces, automation, local models,
      usage, export, planning, native agent runtimes, and reusable
      workflow/standalone agent profiles.
- [ ] **S4-I03** `npm run package:preview:mac` opens the preview profile and the
      same workflow passes without development-only paths.
- [ ] **S4-I04** Windows and Linux package rows remain open until actually
      observed on those platforms.
