# S4-F1-T2 safe native extension adapters

Code-ready headless evidence only. No live UI, package, provider-spend, device,
or runtime-consumption evidence is claimed.

## Delivered boundary

`extension-management/native-adapters.ts` adds one schema-versioned service for
the mutable native Markdown rows in the merged extension capability registry:

- Claude Code user/project skills, commands, and custom agents.
- Codex user/project skills and compatibility commands.
- Cursor Agent project commands.

MCP files remain owned by the dedicated MCP Settings services. Read-only plugin,
OpenCode, and hook rows do not gain fake mutation support.

The production provider-extensions router now exposes read, exact preview,
apply, and backup-restore procedures. Project targets pass through the durable
registered-root guard before the adapter sees a canonical path. User targets
derive from the app-owned home root; callers never choose an arbitrary target
file.

## Safety and recovery

- Adapter metadata is parsed by provider/kind schemas. Unknown frontmatter keys
  are returned explicitly and retained unless removal is directly requested.
- A no-op parse/serialize round trip returns the original bytes exactly.
- Every apply rechecks the preview hash under a target mutex, writes a
  same-root backup, then rechecks the hash inside the shared rooted atomic
  writer before and after its commit hook.
- Deletes rename before removal. Failed post-commit verification restores the
  prior bytes; stale previews and stale restores fail closed.
- Backup JSON is strict, checksummed, target-bound, and read through the same
  rooted no-symlink path service.
- Names are single normalized segments. Registered roots, traversal, symlinked
  parents, symlinked files, inode swaps, and oversized files fail before native
  content is changed.

## Headless verification

`tests/native-extension-adapters.test.ts` covers pinned Claude, Codex, and
Cursor fixtures; byte-exact round trips; schema failures; unknown-field
retention; registry coverage; exact previews; atomic update/create/delete;
backup restore; malformed backup; stale preview/restore; traversal; symlink
escape; and committed-write rollback.

Focused Node 22 adapter, capability-registry, Stage 3 provider-extension, and
rooted path-safety suites pass. Focused ESLint passes. Repository TypeScript
currently reaches unrelated pre-existing errors in local-model catalog parsing
and Codex ACP provider settings; no adapter or provider-extension-router error
is reported. The combined `npm run check` could not start because another
Flapstack worktree held the shared heavy-job lock.

## Manual verification remaining

The task completion row stays unchecked. T1's declared Stage 3 exit dependency,
live Settings use, restart/runtime consumption, packaged preview, and integrated
Stage 4 acceptance remain unverified. Cross-harness conversion, policy, and UI
belong to later S4-F1 tasks.
