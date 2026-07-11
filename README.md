# Flapstack

Private local-first workspace for multi-project, multi-agent coding work.

Flapstack is being built from the open-source 1Code codebase as a Codex-like UI
for coordinating projects, tasks, chats, worktrees, permissions, checkpoints,
and agent runs across tools like Codex and Claude Code.

## Current Status

Stage 0 (repo adoption) and Stage 1 (MVP core) are complete. The approved Stage 2
implementation scope is complete and in manual/package validation; it is **not**
at full exit yet. Voice, usage, Cursor, OpenRouter/NanoGPT through an OpenCode
sidecar, reasoning output, and the smaller-fix surfaces all have runnable
implementation, but the remaining evidence gates and exact human test steps are tracked in the
[Stage 2 full-feature matrix](docs/stage2-full-feature-test-matrix.md).
The research-only dynamic-vocabulary architecture is explicitly deferred: it is
not an approved Stage 2 requirement and is not claimed as implemented.

- Base code: 1Code, rebranded to Flapstack
- Repo visibility: private for now
- Target harnesses: Codex and Claude Code
- Stage 1 shipped: global/project/task chats, unified Codex + Claude Code agent
  runs, permission modes with copy-on-create inheritance, worktree defaults,
  file/pasted-text attachments, scoped search, pin/archive, and before/after
  checkpoints with per-run file-change manifests
- Stage 2 validation: the supported Node gate is green, including strict
  TypeScript. Electron 39.8.10 and electron-builder 26.15.3 are package-validated
  on unsigned arm64/x64 macOS artifacts. Human macOS/Windows, credentialed
  provider, reasoning, daemon, and deep-count matrix evidence remains open.
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
- Dynamic vocabulary remains deferred pending a future approved OpenSpec change.

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

OpenRouter + NanoGPT OpenCode-backed harnesses:

- Flapstack-owned launcher, isolated configuration, authenticated HTTP/SSE
  bridge, and persistence around a pinned local OpenCode sidecar.
- Provider keys, model catalogs, chips, usage capture, and visible reasoning
  normalization.
- OpenCode owns the model/tool loop; Flapstack maps permission modes, shows the
  exact requested command/path patterns, records decisions, and controls the
  run lifecycle. Browser/MCP parity must be verified rather than inferred.

Smaller fixes (Stage 1 carryover plus backlog):

- Keep the resolved strict-TypeScript baseline enforced by `npm run check` and CI.
- Harden native-module setup (better-sqlite3 / node-pty) so Node and Electron
  ABI targets no longer need a manual rebuild toggle.
- Keep Codex/Claude permission previews and persisted run limitations aligned
  with the controls each harness actually enforces.
- Finish worktree UX gaps: custom path entry and honest unknown/needs-refresh
  status when the app cannot infer state.
- Finish scoped search navigation so a result opens the chat at the matched
  message, and remove hidden first-page-only result behavior.
- Finish attachment/artifact UX so task artifacts are visible and attachment
  trays can show more than the first few items.
- Finish run history UX so users can page or expand beyond the first few runs.
- Make cross-scope chat moves discoverable from menus, not only hidden
  drag/toggle paths.
- Keep repo docs in sync with shipped status and remaining carryover work.

### Stage 3: MCP Control

- Clear and prove all TypeScript and Stage 3-blocking engineering debt before
  expanding the MCP surface; keep strict TypeScript and the full gate green.
- MCP tools for agents to inspect and control app objects.
- Structured operations for projects, tasks, chats, runs, files, and worktrees.
- Permission gates around agent-initiated app actions.
- Cross-harness thread spawning: Claude can create a Codex thread, Codex can
  create a Claude thread, and other supported harnesses can target each other
  through approved and audited create-thread and launch-run operations.
- Basic parent/initiator lineage for spawned threads; graph UI, budgets, depth
  limits, and swarm controls remain later work.
- User approval before agent-created automations become active.
- User-facing MCP exposure, approval, connection status, and audit controls.
- Default-off exposure, self-reference guards, worktree write safety, launch
  loop protection, and no background focus theft.

### Stage 4: Knowledge, Workspaces, And Multi-Agent Operations

- Unified skills and hooks manager across supported harnesses.
- Project knowledge vaults for durable docs, decisions, context, and memory.
- Multi-agent orchestration with lineage, budgets, depth limits, and kill controls.
- Saved project/task workspaces combining chats, terminals, agents, worktrees,
  browser/editor/diff panes, tabs, and pop-outs.

Stage 2 owns Flapstack's in-app STT/TTS. Handy covers standalone system-wide
dictation; no separate Flapstack voice platform is planned.

### Later

- Automation and scheduler.
- Local models.
- Additional usage providers, account coverage, and dashboard depth.

## Development

Prerequisites:

- Node.js 22
- Python 3.11 recommended for native module rebuilds
- Xcode Command Line Tools on macOS
- CMake for macOS/Linux packages that build bundled whisper.cpp binaries

Install and run:

```bash
npm ci --legacy-peer-deps
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
npm run package:smoke:mac
```

Every package build command resolves one exact target set, uses it for both pinned
Claude/Codex/whisper.cpp preparation and electron-builder, validates a fresh
allowlisted staging tree, then replaces `resources/bin`. The macOS command builds
arm64 and x64; Windows builds x64; Linux exposes explicit x64 and arm64 commands.
Before electron-builder can rebuild shared native modules, packaging invalidates
the ABI marker. The next dev/test command probes real SQLite and PTY loads, repairs
the required Node/Electron ABI, verifies it, and only then writes a new marker.

## Useful Commands

```bash
npm run lint
npm run style:check
npm run test
npm run build
npm run check
npm run smoke:usage-daemon
npm run ts:check # also runs inside npm run check
```

`npm run check` is the CI/pre-commit gate. It runs lint, formatting, strict
TypeScript, tests, and the production build; CI enforces the same steps.

## Source Attribution

Flapstack contains modified code from the open-source 1Code project by the
21st.dev team.

The base project is Apache-2.0 licensed; see [LICENSE](LICENSE). References to
Flapstack identify this derivative project and do not imply endorsement by
21st.dev or the original 1Code authors.
