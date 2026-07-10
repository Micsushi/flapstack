# Flapstack

Private local-first workspace for multi-project, multi-agent coding work.

Flapstack is being built from the open-source 1Code codebase as a Codex-like UI
for coordinating projects, tasks, chats, worktrees, permissions, checkpoints,
and agent runs across tools like Codex and Claude Code.

## Current Status

Stage 0 (repo adoption) and Stage 1 (MVP core) are complete. Stage 2 (voice,
usage, smaller fixes, Cursor, OpenRouter, and NanoGPT provider work) is next.
Some Stage 1 carryover polish remains tracked in Stage 2 so the MVP is honest to
manually test instead of hiding thin or capped surfaces.

- Base code: 1Code, rebranded to Flapstack
- Repo visibility: private for now
- Target harnesses: Codex and Claude Code
- Stage 1 shipped: global/project/task chats, unified Codex + Claude Code agent
  runs, permission modes with copy-on-create inheritance, worktree defaults,
  file/pasted-text attachments, scoped search, pin/archive, and before/after
  checkpoints with per-run file-change manifests
- Current UI note: the inherited vertical middle sub-chats **Chats** pane is
  hidden behind `SUBCHATS_SIDEBAR_PANEL_ENABLED=false`. Sub-chat tabs, quick
  switch, split view, and routing remain active. Revisit the pane later only if
  multiple parallel sub-chats inside one chat become a normal workflow.

## Product Direction

Flapstack is not just a fork with a new skin. The intended product model is:

```text
Global Chat
Project -> Project Chat
Project -> Task -> Task Chat
Chat -> Agent Runs
```

Projects and tasks are context containers. Chats are the primary object. Agent
runs should be traceable to prompts, checkpoints, file-change manifests, models,
harnesses, permissions, and worktrees.

## Plan

### Stage 0: Repo Adoption

- Copy the 1Code codebase into the private Flapstack repo.
- Rebrand runtime code, local paths, themes, package metadata, and product UI
  to Flapstack while keeping source attribution.
- Disable inherited hosted app sign-in, hosted sandbox/chat APIs, public sync,
  release automation, signing overrides, and auto-update infrastructure.
- Inspect the existing architecture before product edits.
- Confirm local verification gates: typecheck, build, tests, formatter, and CI.
- Map the existing data model and UI screens to the Flapstack product model.

### Stage 1: MVP Core

- Projects and tasks as context/config containers.
- Global, project, and task chats.
- Codex and Claude Code agent runs.
- Harness/model chips in chat tabs and messages.
- Sub-chat tabs remain active; the old vertical sub-chats **Chats** pane is
  parked/hidden for now.
- Project checkout defaults, task worktree defaults, and a worktree dropdown.
- Simple permission modes plus copy-on-create inheritance.
- Basic file and pasted-text attachments.
- Pin/archive for projects, tasks, and chats.
- Scoped search with include-archived support.
- Before/after checkpoints and prompt/run file-change manifests.

### Stage 2: Voice, Usage, Cursor, OpenRouter, NanoGPT, and Fixes

Five tracks plus fixes.

Voice (reuses Agent Hotline):

- Speech-to-text input, cloud plus a local/offline engine.
- Read-aloud output: system voice plus offline Kokoro, no API key required.
- Spoken/displayed response separation inspired by Agent Hotline.
- Per-OS speech adapters with an offline/local path kept as a supported default.

Usage tracking (reuses onWatch):

- Provider quota/spend polling for Anthropic, Codex, Cursor, OpenRouter, and
  NanoGPT.
- Historical usage in SQLite with threshold alerts before throttling or budget.
- Usage dashboard reimplemented in the app UI.
- Exact usage/cost where providers return it; marked estimates from token counts
  and model pricing when exact billing data is absent.

Cursor harness:

- `cursor-agent` CLI adapter with stream-json parsing.
- Cursor login/status detection.
- Cursor permission mapping and honest limitation surfacing.
- Cursor chips and model selector wiring.

OpenRouter + NanoGPT direct API harnesses:

- OpenAI-compatible streaming chat adapters owned by Flapstack.
- Provider keys, model catalogs, chips, usage capture, and visible reasoning
  normalization.
- App-owned permission-gated tool loop so these providers can get the same local
  computer access surface as Codex and Claude: file read/write, shell, git,
  browser, and MCP where the selected permission mode allows it.

Smaller fixes (Stage 1 carryover plus backlog):

- Resolve inherited strict-TypeScript debt and promote `npm run ts:check` into
  the CI/commit gate.
- Harden native-module setup (better-sqlite3 / node-pty) so Node and Electron
  ABI targets no longer need a manual rebuild toggle.
- Harden Codex/Claude permission enforcement and surface any harness limitation
  before launch and on each run.
- Finish worktree UX gaps: custom path entry and honest unknown/needs-refresh
  status when the app cannot infer state.
- Finish scoped search navigation so a result opens the chat at the matched
  message, and remove hidden first-page-only result behavior.
- Finish attachment/artifact UX so task artifacts are visible and attachment
  trays can show more than the first few items.
- Finish run history UX so users can page or expand beyond the first few runs.
- Make cross-scope chat moves discoverable from menus, not only hidden
  drag/toggle paths.
- Keep repo docs and vault docs in sync with shipped status and remaining
  carryover work.

### Stage 3: MCP Control

- MCP tools for agents to inspect and control app objects.
- Structured operations for projects, tasks, chats, runs, files, and worktrees.
- Permission gates around agent-initiated app actions.
- User approval before agent-created automations become active.

### Later

- Automation and scheduler.
- Local models.
- Full skill manager.
- Usage and limits tracking.
- Project Obsidian vault integration.
- Spawned-agent/thread graph.

## Development

Prerequisites:

- Node.js 22
- Python 3.11 recommended for native module rebuilds
- Xcode Command Line Tools on macOS

Install and run:

```bash
npm install
npm run claude:download
npm run codex:download
npm run dev
```

Build:

```bash
npm run build
```

Package:

```bash
npm run package:mac
```

## Useful Commands

```bash
npm run lint
npm run style:check
npm run test
npm run build
npm run check
```

`npm run check` is the CI/pre-commit gate. `npm run ts:check` is available but
currently tracks inherited type debt and is not part of CI yet.

## Source Attribution

Flapstack contains modified code from the open-source 1Code project by the
21st.dev team.

The base project is Apache-2.0 licensed; see [LICENSE](LICENSE). References to
Flapstack identify this derivative project and do not imply endorsement by
21st.dev or the original 1Code authors.
