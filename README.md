# Flapstack

Private local-first workspace for multi-project, multi-agent coding work.

Flapstack is being built from the open-source 1Code codebase as a Codex-like UI
for coordinating projects, tasks, chats, worktrees, permissions, checkpoints,
and agent runs across tools like Codex and Claude Code.

## Current Status

This repo is in the initial adoption phase.

- Base code: 1Code
- Repo visibility: private for now
- Source has been copied into this repo and rebranded from 1Code to Flapstack
- Initial target harnesses: Codex and Claude Code
- First product slice: project/task/chat workflow with worktree defaults,
  permissions, attachments, scoped search, pin/archive, and run checkpoints

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
- Project checkout defaults, task worktree defaults, and a worktree dropdown.
- Simple permission modes plus copy-on-create inheritance.
- Basic file and pasted-text attachments.
- Pin/archive for projects, tasks, and chats.
- Scoped search with include-archived support.
- Before/after checkpoints and prompt/run file-change manifests.

### Stage 2: Voice

- Speech-to-text input.
- Read-aloud output.
- Spoken/displayed response separation inspired by Agent Hotline.
- Per-OS speech adapters with an offline/local path kept open.

### Stage 3: MCP Control

- MCP tools for agents to inspect and control app objects.
- Structured operations for projects, tasks, chats, runs, files, and worktrees.
- Permission gates around agent-initiated app actions.
- User approval before agent-created automations become active.

### Later

- Automation and scheduler.
- Local models and OpenRouter.
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
