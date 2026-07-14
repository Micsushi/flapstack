# S4-F1-T3 extension enablement policy

Code-ready evidence only. No live UI, provider, package, device, or external
harness mutation evidence is claimed.

## Persisted contract

Migration `0030_extension_enablement_policy` adds one additive policy table.
Provider-native files remain unchanged. Each row records an extension identity,
its registered harness/kind/native scope, one `user`, `project`, or `task`
decision, and the owning project/task foreign keys where applicable.

The resolver applies this exact order:

1. task decision;
2. project decision;
3. user decision;
4. fixed enabled default, preserving pre-migration behavior.

Unsupported capability/scope combinations fail before insert or update. The
resolved DTO returns `support: unsupported`, `enabled: false`, and a concrete
reason instead of manufacturing provider state.

## Production surfaces

`providerExtensions` now exposes resolved inventory plus set, clear, and
single-extension resolution procedures. Mutations resolve the extension from
the current native inventory before storing policy.

Managed Claude Code, Codex, and Cursor runs resolve policy from the chat's
project/task ownership. Their internal startup context contains the enabled
availability set, explicit disabled identities, and decision source. The same
manifest is attached to run message metadata. OpenCode extension inventory is
explicitly unsupported because managed sidecars do not consume it; disabled
hooks and read-only/unknown runtime rows also reject policy writes.

## Headless verification

`tests/extension-enablement-policy.test.ts` covers:

- user/project/task/fixed-default precedence;
- unsupported capability and mismatched task rejection before writes;
- persisted resolution after close, reopen, and idempotent migration;
- enabled-set run context for Claude Code, Codex, and Cursor;
- router integration and the serialized `0029 -> 0030` journal with no `0031`.

## Remaining proof

- Live provider runs must confirm each supported harness honors the resolved
  enabled/disabled context with real native extensions.
- The unified Settings UI and accessibility walkthrough belong to S4-F1-T5.
- Dev-profile restart and packaged-preview migration proof belong to S4-F1-T7.
- Hook enablement remains owned by S4-F1-T6.

The S4-F1-T3 completion checkbox stays open until the live provider behavior is
observed rather than inferred from headless context assembly.
