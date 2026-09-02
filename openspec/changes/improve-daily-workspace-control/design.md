## Context

Flapstack has Claude multi-account rows, one global Codex home, app-managed API
keys, per-chat Claude config directories, read-only repository viewers, raw-text
terminal history, and a secure mobile PWA. The change extends these authorities
instead of importing Orca's stores or protocols.

## Goals / Non-Goals

- Goals: account-correct launches and usage, fast navigation, review feedback,
  safe rich editing, bounded previews/diffs, recoverable terminals, sparse
  worktrees, and evidence-driven cleanup.
- Non-goals: remote hosts, embedded browser, native mobile, replacing SQLite,
  unlimited Chat panes, or a second permission/audit system.

## Decisions

### Account-owned runtime homes

- Codex managed accounts own isolated `CODEX_HOME` directories. Claude managed
  accounts own encrypted complete credential blobs and isolated auth material.
- Runs snapshot provider, account ID, auth mode, runtime target, and credential
  revision before launch. Switching affects only new launches.
- Secrets never cross renderer RPC. Main-process services return redacted status,
  identity, usage, and repair information only.
- Claude refresh rotation is serialized per account and persisted atomically.
- Usage providers resolve the exact selected account target and retain current
  SQLite samples, attribution, alerts, budgets, and organization APIs.

### One workspace command surface

- Quick Open composes existing file, Chat, project, worktree, settings, and
  command providers behind typed result and error contracts.
- File discovery streams from cancellable `rg`/filesystem work. A shared
  single-flight scan is preferred over a new persistent index.

### Review and editing reuse current files and checkpoints

- Diff comments bind to diff identity plus file/side/range and become stale
  instead of silently moving after the diff changes.
- Sending comments creates one visible agent turn. It does not stage, commit,
  push, or modify files itself.
- File writes use compare-and-save content identity, explicit conflicts, undo,
  permissions, and audit. Autosave never overwrites an externally changed file.

### Terminal lifetime belongs outside React

- A main/daemon terminal authority owns PTYs and a bounded serialized xterm
  journal. Renderers attach, detach, park, and replay.
- Terminal splits live inside an existing terminal pane and do not raise the
  four-visible-Chat group cap.
- Sleep prevention is one cross-platform service with Off, Automatic, and On
  modes. Automatic follows qualifying owned work, exposes failure state, and
  releases assertions on stop, sleep/wake recovery, crash recovery, and quit.

### Workspace lifecycle separates inventory from mutation

- Sparse-checkout changes preview exact paths and block on dirty or untracked
  loss risk. The prior worktree configuration is journaled for rollback.
- Cleanup scanning is read-only, cancellable, host-aware, and excludes active or
  unverifiable resources. Mutation revalidates each exact identity and uses
  trash/quarantine or an explicit irreversible confirmation.

## Migration Plan

1. Add additive account and run-provenance fields without changing existing
   global/system-default behavior.
2. Import current Claude managed tokens as accounts requiring reauthentication
   before their first expired-token launch.
3. Seed one Codex system-default target without copying or rewriting `~/.codex`.
4. Introduce new search, comment, file-write, and terminal journal contracts
   behind disabled capability flags, then migrate surfaces one at a time.

## Risks / Trade-offs

- Provider auth formats are not product APIs. Parsers remain versioned and fail
  closed with reauthentication guidance.
- Terminal journals can grow. Enforce row/byte/age budgets and garbage collection.
- Autosave can lose work when identity is weak. Require a content digest or
  filesystem version before every write.
