# S4-F1-T1 Stage 3 extension baseline

Code-ready evidence only. No live UI, package, provider-spend, device, or hook
execution evidence is claimed.

## Reconciled production behavior

| Surface                       | Production behavior                                                                                                                                               | Stage 4 registry result                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider Extensions           | `providerExtensions.list/mutate` owns visible skill, command, plugin, custom-agent, and inventory-only MCP DTOs.                                                  | Provider, harness, kind, scope, native path, CRUD support, Settings surface, and runtime-consumption state are explicit.                                                                                                   |
| Legacy skills/commands/agents | Routers remain callable, including compatibility Codex paths and enabled Claude plugin components, but `settings-content.tsx` mounts Provider Extensions instead. | Compatibility rows remain explicit and cannot be mistaken for promoted Settings/runtime parity.                                                                                                                            |
| Plugins                       | Provider Extensions shows installed Claude plugins read-only; the older plugin router still owns enablement but is not the mounted Plugins tab.                   | Plugin inventory is supported, mutation is empty, and runtime consumption is unknown. Plugin components are separate compatibility rows.                                                                                   |
| Third-party MCP               | Claude Code and Codex use the mounted MCP Settings service; Cursor and OpenCode are inventory-only in Provider Extensions.                                        | Claude Code user/project CRUD, plugin approval, Codex global add/remove, Codex project read-only, Cursor unknown consumption, and OpenCode non-consumption are distinct. Product/dev-control MCP identities stay excluded. |
| Hooks                         | `hooksManagement.getCapabilities` advertises Claude Code and Codex but disables discovery, mutation, and execution.                                               | User/project hook rows are `disabled`; every other hook combination is `unsupported`.                                                                                                                                      |

The schema produces 72 exhaustive cells: four harnesses by six kinds by three
scopes. Current classification is 27 supported, 5 compatibility, 4 disabled,
and 36 unsupported. Unsupported cells remain present instead of disappearing.

## Shipped-harness fixture

The focused fixture pins the contracts exercised by Stage 3:

- Claude Agent SDK 0.3.207 / Claude Code 2.1.207.
- Codex ACP 1.1.2 / bundled Codex CLI 0.144.1.
- Cursor Agent 2026.07.09-a3815c0 fixture.
- OpenCode sidecar 1.17.18.

`tests/extension-capability-registry.test.ts` compares every non-unsupported
row with `tests/fixtures/extension-management/stage3-capability-baseline.json`,
maps real provider discovery DTOs back to registry rows, checks hook-disablement
parity, and exercises the production registry query.

## Exact additive gaps

| Gap ID                  | Current boundary                                                                 | Additive owner                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `native-adapter-safety` | Stage 3 has provider-scoped atomic writes, but no preview or backup DTO.         | S4-F1-T2 adds lossless preview, backup, restore, and unknown-field results.                               |
| `scoped-enablement`     | No user -> project -> task extension policy exists.                              | S4-F1-T3 adds persisted policy and run-context resolution.                                                |
| `cross-harness-copy`    | No conversion preview or unsupported-field result exists.                        | S4-F1-T4 adds exact, converted, or unsupported copy previews.                                             |
| `manager-ui`            | Provider Extensions and MCP are separate; compatibility routers remain callable. | S4-F1-T5 builds one manager from the registry after T2-T4.                                                |
| `hook-lifecycle`        | Hook discovery and execution are disabled.                                       | S4-F1-T6 adds validation, exact command review, bounded dry-run, redacted audit, and explicit enablement. |

These gaps are returned as structured DTOs by
`providerExtensions.getCapabilities`; later tasks do not need to infer them from
UI copy or filesystem contents.

## Remaining proof

S4-F1-T1 completion remains unchecked while the declared Stage 3 S3-F11/S3-F13
exit and archive proof remains open. S4-F1 live UI, package, provider, hook, and
device evidence also remains unclaimed. Those gates do not block this additive
code baseline, but they do block a truthful completion claim.
