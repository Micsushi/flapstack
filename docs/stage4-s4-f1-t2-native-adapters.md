# S4-F1-T2 safe native extension adapters

Code-ready headless evidence only. No live UI, package, provider-spend, device,
or runtime-consumption evidence is claimed.

## Delivered boundary

`extension-management/native-adapters.ts` adds one schema-versioned service for
the mutable native Markdown rows in the merged extension capability registry:

- Claude Code user/project skills, commands, and custom agents.
- Codex user/project skills and compatibility commands.
- Cursor Agent project commands.

Six byte-exact fixtures pin the distinct native formats behind all eleven rows:
Claude Code skills, legacy commands, and custom agents; Agent Skills-compatible
Codex skills; Codex compatibility commands; and plain Markdown Cursor commands.
Claude skill and custom-agent schemas include the fields shipped by the pinned
Claude Code contract while retaining truly unknown provider fields explicitly.

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
- Every apply rechecks the old-file hash under a target mutex and requires a
  confirmation hash over the exact previewed path, operation, before/after
  hashes, unknown fields, and diff. A changed apply payload cannot reuse an
  earlier reviewed preview.
- Applies write a same-root backup, then recheck the target inside the shared
  rooted atomic writer before and after its commit hook.
- Deletes rename before removal. Failed post-commit verification restores the
  prior bytes; stale previews and stale restores fail closed.
- Backup JSON is strict, checksummed, target-bound, and read through the same
  rooted no-symlink path service.
- Names are single normalized segments. Registered roots, traversal, symlinked
  parents, symlinked files, inode swaps, and oversized files fail before native
  content is changed.

## Headless verification

`tests/native-extension-adapters.test.ts` covers every non-MCP mutable registry
row against the six pinned Claude, Codex, and Cursor formats; byte-exact round
trips; current known fields; schema failures; unknown-field retention; exact
preview confirmation; atomic update/create/delete; target-bound backup restore;
malformed backup; stale preview/restore; traversal; parent/final symlinks; and
committed-write rollback.

Node 22 focused adapter, capability-registry, provider-extension, rooted
path-safety, cross-harness compatibility, and manager-contract suites pass 99
tests. Repository TypeScript, focused ESLint, focused Prettier, strict OpenSpec,
git diff check, and the production build pass.

## Verification boundary

T2's declared verification is headless, so its completion row is checked. No
live Settings, provider execution, runtime/restart, packaged preview, or device
evidence is claimed. Cross-harness conversion, policy, UI, and integrated live
acceptance remain owned by later S4-F1 tasks.
