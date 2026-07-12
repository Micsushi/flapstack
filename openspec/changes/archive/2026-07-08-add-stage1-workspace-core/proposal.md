# Change: Add Stage 1 workspace core (tasks, chat scopes, unified runs)

## Why

Flapstack's product shape requires chats to be global, project-scoped, or
task-scoped, with every agent run tied to a harness, model, permission mode,
worktree, checkpoint pair, and file-change manifest. The inherited 1Code data
model only supports project-bound chats with no tasks, no run records, and
permissions hardcoded to bypass.

## What Changes

- Add first-class tasks as folder-like context containers inside projects.
- Allow chats to be global (`projectId` nullable - **BREAKING** schema change),
  project-scoped, or task-scoped, with move/promote/detach between scopes.
- Add unified `agent_runs` records for Codex and Claude Code launches, with
  harness/model/permission/worktree identity persisted per run and per
  assistant message.
- Add permission modes (read-only, ask-before-edits, auto-edit-project-only,
  full-access, custom) with copy-on-create inheritance
  global → project → task → chat/run, replacing the hardcoded
  `bypassPermissions` launch path (**BREAKING** behavior change).
- Add scope-based worktree defaults (project checkout / shared task worktree)
  with a user-overridable worktree selection and honest unknown states.
- Persist chat attachments and add explicit promote-to-task-artifact and
  write-to-worktree actions.
- Add pin/archive/restore with undo for projects, tasks, and chats.
- Add scoped search (all/project/task/chat) with include-archived toggle.
- Capture before/after checkpoints and a file-change manifest for every run.

## Impact

- Affected specs: chat-scopes, task-containers, agent-runs, run-permissions,
  worktree-defaults, chat-attachments, workspace-lifecycle, scoped-search,
  run-checkpoints (all new capabilities).
- Affected code: `src/main/lib/db/schema/index.ts` + new drizzle migrations;
  routers `chats.ts`, `projects.ts`, `claude.ts`, `codex.ts` and new routers
  `tasks.ts`, `permissions.ts`, `runs.ts`, `search.ts`; new
  `src/main/lib/harness/`, `worktree-resolver.ts`, `checkpoints.ts`; renderer
  sidebar, chat input area, chips, details sidebar, attachments UI, archives
  view, scoped search UI.
- Execution detail: this archived change's `tasks.md` lists all 27 tasks
  (A1-E3) and their ordering.
