## Context

The repo already reads Claude and Codex skill/command roots and exposes
provider-scoped extension settings. `hooks-management.ts` is intentionally
disabled until validation and dry-run policy exist.

## Goals / Non-Goals

- Goals: honest inventory, safe native-file editing, explicit sharing,
  project/task policy, and safe hook lifecycle.
- Non-goals: one lossy universal file format, automatic parity, marketplace
  hosting, or silent hook execution.

## Decisions

- Keep provider-native content as source of truth. Normalize only identity,
  source, scope, support state, enabled policy, and validation results.
- Every mutation shows target path and diff, then uses atomic write plus backup.
- Cross-harness copy uses an adapter and returns `exact`, `converted`, or
  `unsupported`; source content is never changed.
- Hook lifecycle is `discovered -> validated -> dry-run -> explicitly enabled`.
  Imported hooks stop at `discovered`.
- Task policy overrides project policy, which overrides user default. Unsupported
  scopes render as unsupported and do not write fake configuration.

## Risks / Trade-offs

- Harness formats drift. Keep adapter fixtures pinned to shipped harness versions
  and show unknown fields instead of discarding them.
- Hooks execute code. Reuse registered-root validation, permission gates, redacted
  audit, exact command preview, and fail-closed enablement.

## Migration Plan

Read current native files into the registry without rewriting them. Add policy
records additively. Removal rolls back policy records and leaves native files.

## Open Questions

- None blocking. The default is native passthrough plus explicit conversion,
  not a canonical universal extension language.
