# Tasks

Mirrors the vault task board (`stage1-implementation-tasks.md`, tasks A1–E3),
which carries per-task files, scope, done criteria, and dependencies.

## 1. Foundation (Block A)

- [x] 1.1 A1 OpenSpec proposal + baseline check + seeded throwaway DB plan
- [ ] 1.2 A2 Schema: `tasks` table + `projects` pin/archive/permission columns
- [ ] 1.3 A3 Schema: `chats` nullable projectId, scope, taskId, harness,
      model, pinnedAt; `sub_chats` run fields
- [ ] 1.4 A4 Schema: `agent_runs`, `checkpoints`, `file_change_manifests`,
      `attachments`
- [ ] 1.5 A5 Migration verification on DB copy
- [ ] 1.6 A6 `tasks.ts` router (CRUD, pin/archive, primary worktree)
- [ ] 1.7 A7 Permissions lib + router (copy-on-create, resolveForRun)
- [ ] 1.8 A8 `runs.ts` router skeleton
- [ ] 1.9 A9 `search.ts` router (scoped, archived-aware)
- [ ] 1.10 A10 `projects.ts` pin/archive/permission procedures
- [ ] 1.11 A11 `chats.ts` scoped create/list/move/pin

## 2. Run Path (Block B)

- [ ] 2.1 B1 Shared harness types + chip constants
- [ ] 2.2 B2 Worktree resolver + honest worktree status
- [ ] 2.3 B3 Claude launch path: permission mapping, run records, metadata
- [ ] 2.4 B4 Codex launch path: sandbox mapping, run records, metadata
- [ ] 2.5 B5 Checkpoint + manifest capture wired into run lifecycle

## 3. UI Shell (Block C)

- [ ] 3.1 C1 Sidebar tree (global/projects/tasks) + DB pinning
- [ ] 3.2 C2 Scope-aware new-chat flow + empty states
- [ ] 3.3 C3 Input bar: harness/model/permission/worktree selectors
- [ ] 3.4 C4 Harness/model/worktree chips on tabs and messages
- [ ] 3.5 C5 Details panel: run history + checkpoints sections
- [ ] 3.6 C6 Local-first onboarding unblock

## 4. Attachments, Lifecycle, Search UI (Block D)

- [ ] 4.1 D1 Attachment persistence + promote/write actions
- [ ] 4.2 D2 Pin/archive/restore/undo UI + archives view
- [ ] 4.3 D3 Scoped search UI with breadcrumb navigation

## 5. Verification (Block E)

- [ ] 5.1 E1 Unit tests (permissions, scopes, worktrees, search, manifests)
- [ ] 5.2 E2 Manual test matrix pass
- [ ] 5.3 E3 Docs, handoff, and OpenSpec archive
