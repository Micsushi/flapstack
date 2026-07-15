# S4-F1-T1 Stage 3 extension baseline

Code-ready evidence only. No live UI, package, provider-spend, device, or hook
execution evidence is claimed.

## Reconciled production behavior

| Surface                       | Production behavior                                                                                                                                                                   | Stage 4 registry result                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider Extensions           | `providerExtensions.list/mutate` owns visible skill, command, plugin, custom-agent, and inventory-only MCP DTOs.                                                                      | Provider, harness, kind, scope, native path, CRUD support, Settings surface, and runtime-consumption state are explicit.                                                                                                   |
| Legacy skills/commands/agents | Routers remain callable, including compatibility Codex paths and enabled Claude plugin components, but `settings-content.tsx` mounts Provider Extensions instead.                     | Compatibility rows remain explicit and cannot be mistaken for promoted Settings/runtime parity.                                                                                                                            |
| Plugins                       | Provider Extensions shows installed Claude plugins read-only; the older plugin router still owns enablement but is not the mounted Plugins tab.                                       | Plugin inventory is supported, mutation is empty, and runtime consumption is unknown. Plugin components are separate compatibility rows.                                                                                   |
| Third-party MCP               | Claude Code and Codex use the mounted MCP Settings service; Cursor and OpenCode are inventory-only in Provider Extensions.                                                            | Claude Code user/project CRUD, plugin approval, Codex global add/remove, Codex project read-only, Cursor unknown consumption, and OpenCode non-consumption are distinct. Product/dev-control MCP identities stay excluded. |
| Hooks                         | `hooksManagement.getCapabilities` advertises managed Claude Code and Codex import, validation, bounded dry-run, approval, audit, explicit enablement, and direct-runtime consumption. | User/project rows are injected at launch without provider-file mutation; plugin and other-harness hook rows stay `unsupported`.                                                                                            |

The schema produces 72 exhaustive cells: four harnesses by six kinds by three
scopes. Current classification is 31 supported, 5 compatibility, 0 disabled,
and 36 unsupported. Unsupported cells remain present instead of disappearing,
carry no mutations or paths, and fail closed with an explicit limitation.

## Shipped-harness fixture

The focused fixture pins the contracts exercised by Stage 3:

- Claude Agent SDK 0.3.207 / Claude Code 2.1.207.
- Codex ACP 1.1.2 / bundled Codex CLI 0.144.1.
- Cursor Agent 2026.07.09-a3815c0 fixture.
- OpenCode sidecar 1.17.18.

`tests/extension-capability-registry.test.ts` compares every supported or
compatibility row plus the exact 36 unsupported identities with
`tests/fixtures/extension-management/stage3-capability-baseline.json`. It also
checks current package pins, maps real provider discovery DTOs back to registry
rows, checks managed-hook/runtime parity, and exercises the production registry
query.

## Current additive ownership

| Gap ID                  | Current boundary                                                                                        | Remaining owner evidence                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `native-adapter-safety` | Lossless rooted read/preview/apply/backup/restore DTOs exist for supported mutable rows.                | S4-F1-T2 owns live Settings, reload, package, and integrated acceptance.                                      |
| `scoped-enablement`     | Persisted user/project/task policy reaches supported launch contracts without rewriting native content. | S4-F1-T3 owns live provider and Dev/package restart evidence.                                                 |
| `cross-harness-copy`    | Exact/converted/unsupported previews precede every confirmed native copy write.                         | S4-F1-T4 owns dependency-gated sharing acceptance.                                                            |
| `manager-ui`            | One Settings manager consumes registry, adapter, policy, copy, and managed-hook DTOs.                   | S4-F1-T5 owns the live walkthrough, screen-reader observation, restart, and package evidence.                 |
| `hook-lifecycle`        | Managed hooks validate, dry-run, audit, enable explicitly, and bind to direct native launches.          | S4-F1-T6 owns live enable/disable and provider-observed execution evidence without weakening the safety gate. |

These gaps are returned as structured DTOs by
`providerExtensions.getCapabilities`; later tasks do not need to infer them from
UI copy or filesystem contents.

## Stage 3 exit reconciliation

- The annotated `stage3-final` tag resolves to
  `a674784b0141c7a5293c5637c3bea65be6d44c4e`.
- Its archived `complete-settings-reliability` board checks every S3-F11 task,
  including exit S3-F11-T5, and every S3-F13 task, including exit S3-F13-T4.
- Its release-candidate ledger says Stage 3 is complete, maps S3-F11 to T5 and
  S3-F13 to T4, and records all required feature exits as complete.
- The Stage 3 tag and this checkout resolve the same Claude Agent SDK, Claude
  Code, Codex ACP, and bundled Codex CLI pins. Current Cursor and OpenCode
  fixture pins remain `2026.07.09-a3815c0` and `1.17.18`.

That satisfies T1's declared dependency. T1 closes on headless registry/router,
provider, hook, schema, version, and fixture proof. No new live UI, package,
provider-spend, hook execution, device, or later-F1 acceptance evidence is
claimed.
