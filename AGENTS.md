# Flapstack contributor guidance

## Scope

Read the relevant README, document, source entrypoint, and data contract before
editing. Keep changes small and preserve local-only behavior, user data,
permission boundaries, worktree state, and the existing source attribution and
Apache-2.0 notices.

## UI work

For UI work, inspect the current repository UI, source, and docs, then use a
relevant installed skill when available. Preserve project conventions,
accessibility, responsive behavior, and reversal behavior; keep UI copy concise
and actionable; validate the actual user flow. Do not require a new UI file or
private dependency solely to begin focused work.

## Commands

The package declares Node 22 (`>=22 <23`) and npm 10 (`>=10 <11`), with
`npm@10.9.2` pinned as the package manager. Run `npm ci` for a clean dependency
install. Use `npm run dev` for the supervised development lifecycle, then
`npm run dev:verify` when checking a live development instance. Use
`npm run build` for the guarded build and `npm run check` for the repository
check entrypoint. The pinned `npm run claude:download` and
`npm run codex:download` commands download provider binaries only when setup
requires them.

For a documentation-only change, inspect the relevant command definitions and
run only a proportional documentation or formatting check. Do not launch
provider downloads, alter a live profile, or replace the repository's guarded
build and locking entrypoints with ad hoc commands.

## Repository guidance

Keep user-facing instructions in the README or `docs/`; keep contributor
guidance here. Treat projects, tasks, chats, runs, permissions, worktrees, and
profiles as separate objects when documenting behavior. Keep credentials,
local databases, generated output, and temporary plans out of commits.
