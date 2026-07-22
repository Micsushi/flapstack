# Flapstack

Private local-first workspace for multi-project, multi-agent coding work.

Flapstack is being built from the open-source 1Code codebase as a Codex-like UI
for coordinating projects, tasks, chats, worktrees, permissions, checkpoints,
and agent runs across tools like Codex and Claude Code.

## Current Status

Flapstack `0.1.0` is the first macOS beta target. It combines the completed
Stage 3 core with the Stage 4 feature-code pass. Advanced Stage 4 workflows are
optional and default off under **Settings → Beta Features**. The release is not
public until the unsigned DMG package gate and clean first-run Claude/Codex
connection checks pass. macOS will warn because this beta is not signed or
notarized by Apple. See the [0.1.0 beta notes](docs/releases/0.1.0.md) and
[macOS release runbook](docs/releasing-macos.md).

Stage 0 (repo adoption), Stage 1 (MVP core), and Stage 3 are complete. Historical
Stage 2 testing is closed as a separate release gate. The historical exit contract is the
[Stage 3 full-feature matrix](docs/stage3-full-feature-test-matrix.md); the
[release candidate ledger](docs/stage3-release-candidate-ledger.md) and
[integrated candidate release notes](docs/stage3-release-notes.md) record the
current gate truth; the [release lane handoff](docs/stage3-release-handoff.md)
records remaining release authority and cleanup.
[Stage 2 matrix](docs/stage2-full-feature-test-matrix.md) is retained as a
historical criteria record and crosswalk.
Stage 4 portability behavior and operating limits are documented in
[Portability and Private Sync](docs/portability-and-private-sync.md).
Stage 4 plan-source, task-board, promotion, proposal, and concurrency contracts
are documented in [Plan and Kanban](docs/plan-and-kanban.md).
The research-only dynamic-vocabulary architecture is explicitly deferred: it is
not an approved Stage 2 requirement and is not claimed as implemented.

- Base code: 1Code, rebranded to Flapstack
- Repo visibility: private for now
- Target harnesses: Codex and Claude Code
- Stage 1 shipped: global/project/task chats, unified Codex + Claude Code agent
  runs, permission modes with copy-on-create inheritance, worktree defaults,
  file/pasted-text attachments, scoped search, pin/archive, and before/after
  checkpoints with per-run file-change manifests
- Stage 3 integration is based on current `main` and combines production MCP
  control, Settings reliability, the remaining Stage 2 voice/usage/provider/
  reasoning closeout, and one final regression/release gate. Human macOS/
  Windows, credentialed-provider, daemon, reasoning, and deep-count evidence
  remains open until recorded in the Stage 3 matrix.
- Each chat item in the left sidebar is one visible conversation. The inherited
  sub-chat tabs, nested-chat creation, history switcher, and split view are not
  part of the Flapstack product model. Existing `sub_chats` rows remain only as
  non-destructive internal storage compatibility.

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

### Terminology Invariant

In the user interface, **Chat** is the canonical name for an independently
addressable conversation. A provider thread, standalone agent, spawned agent,
worker, or subagent with its own conversation is represented by a durable Chat
and appears in the left sidebar. Parent/initiator lineage explains how spawned
Chats relate to their source.

One Chat/thread represents one durable agent identity and its conversation. A
run is one bounded activation of that agent: a prompt or automation trigger
starts it, and success, failure, or cancellation ends it. Follow-up work may
create another run in the same Chat without creating another agent. A newly
spawned subagent is a new agent identity and therefore gets its own Chat/thread.

Provider thread/session IDs, run records, and compatibility `sub_chats` rows
stay internal. They do not create separate Threads, Agents, or Subagents
navigation. Provider activity without its own addressable conversation stays
inside the parent Chat; a distinct provider conversation must become its own
sidebar Chat.

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
- One visible conversation per sidebar chat; no nested chat tabs or split view.
- Project checkout defaults, task worktree defaults, and a worktree dropdown.
- Simple permission modes plus copy-on-create inheritance.
- Basic file and pasted-text attachments.
- Pin/archive for projects, tasks, and chats.
- Scoped search with include-archived support.
- Before/after checkpoints and prompt/run file-change manifests.

### Stage 2: Voice, Usage, Cursor, OpenRouter, NanoGPT, and Fixes

Implementation baseline complete; unfinished exit work is now routed into Stage
3 features F9 and F14-F17. This section describes the delivered foundation, not
an active release gate.

Voice (reuses Agent Hotline):

- Speech-to-text input, cloud plus a local/offline engine.
- Read-aloud output: system voice plus offline Kokoro, no API key required.
- Spoken/displayed response separation inspired by Agent Hotline.
- Per-OS speech adapters with an offline/local path kept as a supported default.
- Dynamic speech vocabulary is planned in Stage 6 S6-F1 as part of voice-input
  usability and language polish.

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

### Stage 3: Safe Agent Control and Product Closeout

Execution lanes, dependencies, coordinator behavior, and review rounds are in
the [Stage 3 execution plan](docs/stage3-execution-plan.md).

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
- Repair and verify Settings surfaces for honest visibility, shortcuts, voice,
  credentials, provider extensions, permission modes, copy, and search.
- Finish Parakeet-first dictation, Voice History, usage/daemon evidence, Cursor/
  OpenRouter/NanoGPT closeout, and reasoning-output parity migrated from Stage 2.
- End with one integrated automated, live-dev, packaged, cross-platform, and
  documentation gate on `codex/stage3-integration`.

### Stage 4: Knowledge, Workspaces, And Multi-Agent Operations

- Unified skills and hooks manager across supported harnesses.
- Project knowledge vaults for durable docs, decisions, context, and memory.
- Multi-agent orchestration with lineage, budgets, depth limits, and kill controls.
- Saved project/task workspaces combining chats, terminals, agents, worktrees,
  browser/editor/diff panes, tabs, and pop-outs.
- Automation and scheduler with approval, dry-run, budgets, history, and kill controls.
- Local models through the app-owned permission-gated agent loop.
- Advanced usage and limits across runs, chats, tasks, projects, accounts, and harnesses.
- Versioned import/export plus optional user-owned private sync.
- Linked Plan and Kanban views with approved task/chat creation.
- Agent Runtimes preserving native Codex/Claude behavior with Flapstack Native
  compatibility and per-harness/project/chat selection.
- Reusable Agent Profiles and Personalities for deterministic workflow roles
  and standalone named specialists without expanding their authority.

Its eleven OpenSpec feature boards contain 87 bounded tasks; see the
[Stage 4 router](openspec/stages/s4-knowledge-workspaces-operations/README.md)
and [execution plan](docs/stage4-execution-plan.md).

The Stage 4 feature-code pass ships in the `0.1.0` macOS beta. Project Memory,
Orchestration, Saved Workspaces, Automations, and Planning & Task Board remain
explicit opt-ins. Their unfinished provider, UI, package, and platform evidence
is beta work, not a stable-support claim.

### Stage 5: Native Windows Compatibility

- Pin and diagnose Node 22, Python 3.11, CMake, Rust/MSVC, Visual Studio 2022
  Build Tools (including x64/x86 Spectre-mitigated libraries), and Windows SDK
  prerequisites.
- Make install, check, build, download, native rebuild, Dev, verify, and package
  commands work from native PowerShell without WSL, Git Bash, or manual patches.
- Prove clean npm install plus better-sqlite3/node-pty Node and Electron ABI repair.
- Add Windows CI for install, check, build, native inspection, package, and smoke.
- Verify exact-checkout Dev startup, restart, stale-process cleanup, and crash recovery.
- Close Windows paths, Explorer/default-app opening, terminal, DPAPI, scheduled
  tasks, protocols/deep links, process ownership, and power/network lifecycle.
- Prove Claude and Codex download, authentication, run/resume, permissions,
  worktrees, tools, cancellation, restart, and packaged behavior.
- Prove microphone capture, local/cloud STT, system/offline TTS, model lifecycle,
  credential storage, and cleanup without POSIX shell fallbacks.
- Build and inspect native x64 Preview, NSIS, and portable artifacts; prove clean
  install, Stage 4 upgrade, repair, rollback, and both uninstall data choices.
- Add Authenticode-ready signing, hashes, manifests, dependency/license inventory,
  malware/secret gates, support docs, and one exact-SHA integrated release gate.

Stage 5 starts after full Stage 4 acceptance. Its nine features contain 76
bounded tasks; see the
[Stage 5 router](openspec/stages/s5-windows-compatibility/README.md),
[execution plan](docs/stage5-execution-plan.md),
[test matrix](docs/stage5-full-feature-test-matrix.md), and
[manual test](docs/stage5-windows-manual-test.md). Native setup and packaging
commands live in the [Windows development guide](docs/windows-development.md).

### Stage 6: Product Polish, Personalization, and Reach

- Product-wide UI/UX, navigation, Settings, accessibility, and recovery polish.
- Guided first-run tutorial, work-style questions, feature explanations, and
  reversible progressive UI visibility.
- One Agent Profile concept with reusable versioned Markdown personalities,
  universal new-chat/sub-agent selection, and honest effort/speed compatibility.
- Secure cross-agent mobile companion over a default-off local PWA bridge.
- Visual context capture, redaction, artifacts, agent context, and standalone helper.
- Up to four fully interactive Chat groups with VS Code-style directional tab
  drops, resizable mixed layouts, floating-window drag-out, and the same
  compositor extended into terminal-grid/swarm workspaces, with at most four
  visible Flapstack workbench windows total including main.
- Final Runtime/orchestration composition for schemas, control, activity, and recovery.
- Optional OpenAI/Anthropic organization usage APIs with exact provenance.
- Versioned performance budgets, scale/soak testing, and regression gates.
- Signed/notarized macOS plus public promotion of accepted Stage 5 Windows
  artifacts and natively verified Linux distribution.
- Obsidian-compatible project knowledge graph: six seed notes, custom Markdown
  nodes/folders, Wikilinks/backlinks, graph views, and same-folder Obsidian opening.
- One integrated exact-SHA Stage 6 release gate.

Stage 6 starts only after full Stage 5 Windows acceptance. Its twelve OpenSpec feature
boards contain 97 pickup-ready tasks; see the
[Stage 6 router](openspec/stages/s6-product-polish-personalization-reach/README.md),
[execution plan](docs/stage6-execution-plan.md), and
[test matrix](docs/stage6-full-feature-test-matrix.md).

Stage 2 owns Flapstack's in-app STT/TTS. Handy covers standalone system-wide
dictation; no separate Flapstack voice platform is planned.

## Development

Prerequisites:

- Node.js 22
- Python 3.11 recommended for native module rebuilds
- Xcode Command Line Tools on macOS
- CMake for macOS/Linux packages that build bundled whisper.cpp binaries
- On Windows: CMake, Rust MSVC, Visual Studio 2022 Build Tools with Desktop C++
  and x64/x86 Spectre-mitigated libraries, plus the Windows 10/11 SDK

Install and run:

```bash
npm ci --legacy-peer-deps
npm run claude:download
npm run codex:download
npm run dev
```

Before live testing or reporting that a dev change is running, verify the exact
checkout and data profile. This command fails if a packaged build from this
checkout is running or the active renderer is not using `Flapstack Dev` data:

```bash
npm run dev:verify
```

Build:

```bash
npm run build
```

Package:

```bash
npm run package:preview:mac # local packaged testing: Flapstack Preview.app
npm run package:mac
npm run package:release:mac # unsigned beta DMGs for Apple Silicon and Intel
npm run package:smoke:mac
```

macOS development, packaged testing, and production use separate app names,
bundle IDs, protocols, output folders, and data profiles. Use `Flapstack Dev`
for live source work and `Flapstack Preview` for local packaged smoke tests.
`Flapstack` is reserved for production builds.

Every package build command resolves one exact target set, uses it for both pinned
Claude/Codex/whisper.cpp preparation and electron-builder, validates a fresh
allowlisted staging tree, then replaces `resources/bin`. The macOS command builds
arm64 and x64; Windows builds x64; Linux exposes explicit x64 and arm64 commands.
Before electron-builder can rebuild shared native modules, packaging invalidates
the ABI marker. The next dev/test command probes real SQLite and PTY loads, repairs
the required Node/Electron ABI, verifies it, and only then writes a new marker.

See [docs/releasing-macos.md](docs/releasing-macos.md) for the unsigned DMG release
pipeline, Gatekeeper instructions, checksums, and public-release process.

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
