# Project Context

## Purpose

**Flapstack** - A local-first Electron desktop app for multi-project,
multi-agent coding work. Users create global, project, and task chats linked to
local project folders or worktrees, then run coding agents such as Codex and
Claude Code with visible permissions, checkpoints, tool execution, and file
change tracking.

## Tech Stack

| Layer           | Tech                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Desktop         | Electron 39.8.10, electron-vite, electron-builder                                                   |
| UI              | React 19, TypeScript 5.4.5, Tailwind CSS                                                            |
| Components      | Radix UI, Lucide icons, Motion, Sonner                                                              |
| State           | Jotai, Zustand, React Query                                                                         |
| Backend         | tRPC, Drizzle ORM, better-sqlite3                                                                   |
| AI              | @anthropic-ai/claude-agent-sdk, @zed-industries/codex-acp                                           |
| Package Manager | npm (`package-lock.json` is the CI source of truth; `bun.lock`/`bun.lockb` are inherited leftovers) |

## Project Conventions

### Code Style

- Components: PascalCase (`ActiveChat.tsx`, `AgentsSidebar.tsx`)
- Utilities/hooks: camelCase (`useFileUpload.ts`, `formatters.ts`)
- Stores: kebab-case (`sub-chat-store.ts`, `agent-chat-store.ts`)
- Atoms: camelCase with `Atom` suffix (`selectedAgentChatIdAtom`)
- Simplicity over complexity - don't overcomplicate things

### Architecture Patterns

- **IPC Communication**: tRPC with `trpc-electron` for type-safe main↔renderer communication
- **State Management**:
  - Jotai: UI state (selected chat, sidebar open, preview settings)
  - Zustand: internal conversation state (persisted to localStorage). Each
    sidebar chat shows exactly one visible conversation; nested sub-chat tabs,
    quick switch, and the vertical **Chats** pane were removed, and `sub_chats`
    rows persist only as internal storage compatibility.
  - React Query: Server state via tRPC (auto-caching, refetch)
- **Database**: Drizzle ORM with SQLite, auto-migration on app startup
- **Agent Integration**: Claude Code and Codex are the initial target harnesses;
  permissions, worktrees, checkpoints, and file-change manifests should be
  tracked per run.

### Testing Strategy

- Commit gate: `npm run check` (lint, style check, strict TypeScript, Vitest tests,
  production build)
- Unit tests: Vitest (`vitest.config.ts`, tests under `tests/`); pure logic
  (permissions, scope resolution, worktree defaults, search filters, manifests)
  gets focused unit coverage
- `npm run ts:check` is enforced by both `npm run check` and CI
- Manual test matrices live in repo-local stage docs under `docs/`

### Git Workflow

- Main branch: `main`
- Feature branches for development
- PRs for code review

## Domain Context

- **Chat Sessions**: Users create global, project, and task chats linked to local project folders or worktrees.
- **Agent Runs**: Chats can launch Codex, Claude Code, and later additional harnesses.
- **Tool Execution**: Real-time display of agent tool execution such as shell commands, file edits, and web/search actions.
- **Session Resume**: Sessions can be resumed via harness session IDs where supported.

## Important Constraints

- Local-first: All data stored locally in SQLite (`{userData}/data/agents.db`)
- Harness auth uses each provider's local mechanism with encrypted credential storage where needed.
- Hosted app sign-in, release CDN, public sync, and auto-update infrastructure are disabled.
- Dev vs Production use separate userData paths and protocols

## External Dependencies

- **Claude Code SDK**: `@anthropic-ai/claude-agent-sdk` for Claude Code runs
- **Codex ACP**: `@zed-industries/codex-acp` for Codex runs
