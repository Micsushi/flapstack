# S4-F1-T4 cross-harness extension sharing

Code-ready headless evidence only. No live UI, package, provider-spend, device,
or runtime-consumption evidence is claimed.

## Delivered boundary

`extension-management/cross-harness-copy.ts` adds a schema-versioned copy
service over the existing native adapter and capability registries.

- Every preview reports the exact source and target capability rows.
- Results are `exact`, `converted`, or `unsupported`; unsupported mappings have
  no confirmation hash and cannot be applied.
- Claude Code and Codex skills copy bidirectionally. Supported command metadata
  copies among Claude Code, Codex, and Cursor Agent. Missing target adapters and
  fields without declared target equivalents fail closed.
- Renames are explicit conversions. Source files are never mutated.
- Target collisions are either blocked or explicitly previewed as overwrites.
  Preview is stateless, so cancellation requires no cleanup.
- Apply requires the preview's source hash, target hash, and confirmation hash.
  Stale source, target, or preview state fails before write.

## Portability and recovery

- Portable manifests contain only schema version, portable origin identity,
  kind, normalized name, content, and target-supported metadata. They contain
  no native path, `cwd`, source ID, timestamps, runtime state, or file hashes.
- Manifest input is strict. Prototype keys, non-JSON values, excessive nesting,
  and excessive metadata fail closed.
- Source fields without a target equivalent are named but not exported. No
  lossy manifest or target write is offered.
- Target-only unknown native fields survive confirmed overwrites and are named
  in the preview. Known stale target fields are removed only through the exact
  native mutation preview.
- Target writes reuse rooted path validation, symlink/traversal defense, atomic
  commit, backup, verification, and rollback from S4-F1-T2.

## Headless verification

`tests/cross-harness-extension-copy.test.ts` covers both skill directions,
exact and renamed conversion, source preservation, stateless cancellation,
collision reject/overwrite, target unknown-field retention, lossy-field
rejection, explicit unsupported target capabilities, stale source rejection,
post-commit rollback, symlink defense, and portable-manifest sanitization.

Focused Node 22 copy/native-adapter/capability/provider-extension/path-safety
suites pass. Focused and repository ESLint pass. Repository formatting and
strict OpenSpec validation pass. Full TypeScript reaches only two unrelated
pre-existing Codex ACP provider-setting errors in `trpc/routers/codex.ts`.

## Remaining proof

The T4 completion row stays unchecked because its declared T1 and T2
dependencies remain unchecked. T4's own declared headless acceptance and
verification are code-ready. Live manager UI and integrated Dev/package proof
belong to S4-F1-T5 and S4-F1-T7, not this task.
