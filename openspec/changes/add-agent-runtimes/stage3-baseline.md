# Stage 3 Agent Runtime baseline

This document freezes the completed Stage 3 behavior that S4-F11 preserves or
intentionally replaces. All source claims below were read from the peeled
`stage3-final` commit, not from the Stage 4 descendant.

## Baseline identity and reproduction

| Item           | Frozen value                               | Provenance                                                                                                         |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Tag            | `stage3-final`                             | Peeled locally with `git rev-parse stage3-final^{commit}`                                                          |
| Commit         | `a674784b0141c7a5293c5637c3bea65be6d44c4e` | Clean committed Stage 3 integration tree                                                                           |
| Application    | `flapstack@0.0.72`                         | [`package.json`](../../../package.json) and [`package-lock.json`](../../../package-lock.json) at the frozen commit |
| Replay source  | `git archive a674784`                      | Extracted to a disposable directory; no dirty worktree files were copied                                           |
| Replay runtime | Node `22.23.1`, npm `10.9.8`, macOS arm64  | Node 22 is the repository baseline; these are the exact versions used for this freeze                              |

The exact required Stage 3 replay passed from the archive:

```text
Test Files  6 passed (6)
Tests       70 passed (70)
```

Command:

```text
npm test -- tests/reasoning-output-contract.test.ts tests/codex-transport-decision.test.ts tests/codex-reasoning-output-normalizer.test.ts tests/claude-transform-reasoning-output.test.ts tests/chat-handoff.test.ts tests/stage3-migration-rebase.test.ts
```

The same command passed on descendant `99181e81798e4c7289a105ec0d84999939d4fb9f`
with 6 files and 73 tests. The three added tests are Stage 4 migration cases in
[`tests/stage3-migration-rebase.test.ts`](../../../tests/stage3-migration-rebase.test.ts).
The five reasoning, transport, transformer, and handoff test files are unchanged
from `a674784`; the descendant preserves their tested behavior.

## Locked runtime and package versions

`package-lock.json` is the dependency source of truth. Registry dependencies
below resolve to the named npm tarball in that lockfile. Bundled executable
versions are also fixed by the packaging/download scripts.

| Component                    | Frozen version                           | Lock/provenance                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex ACP adapter            | `@agentclientprotocol/codex-acp@1.1.2`   | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| ACP AI SDK provider          | `@mcpc-tech/acp-ai-provider@0.3.3`       | [`package-lock.json`](../../../package-lock.json); patched after install by [`scripts/patch-acp-ai-provider.mjs`](../../../scripts/patch-acp-ai-provider.mjs)                                                                   |
| Bundled Codex CLI/App Server | `@openai/codex@0.144.1`                  | [`package-lock.json`](../../../package-lock.json), [`scripts/download-codex-binary.mjs`](../../../scripts/download-codex-binary.mjs), [`scripts/prepare-package-resources.mjs`](../../../scripts/prepare-package-resources.mjs) |
| Claude Agent SDK             | `@anthropic-ai/claude-agent-sdk@0.3.207` | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| Bundled Claude Code          | `2.1.207`                                | [`scripts/download-claude-binary.mjs`](../../../scripts/download-claude-binary.mjs), [`scripts/prepare-package-resources.mjs`](../../../scripts/prepare-package-resources.mjs)                                                  |
| AI SDK                       | `ai@6.0.219`                             | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| OpenCode sidecar fallback    | `opencode-ai@1.17.18`                    | [`src/main/lib/harness/opencode-sidecar/binary.ts`](../../../src/main/lib/harness/opencode-sidecar/binary.ts)                                                                                                                   |
| Cursor CLI                   | not lockfile-pinned                      | Stage 3 closeout recorded `2026.07.09-a3815c0`; older sanitized fixtures record `2026.07.08-0c04a8a`                                                                                                                            |
| Electron                     | `39.8.10`                                | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| TypeScript                   | `5.9.3`                                  | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| Vitest                       | `4.1.9`                                  | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| better-sqlite3               | `12.11.1`                                | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |
| node-pty                     | `1.1.0`                                  | [`package-lock.json`](../../../package-lock.json)                                                                                                                                                                               |

The lockfile contains platform Codex packages for Darwin, Linux, and Windows,
but package presence is not execution proof for those operating systems.

## Durable Stage 3 data contract

The authoritative definitions are in
[`src/main/lib/db/schema/index.ts`](../../../src/main/lib/db/schema/index.ts).

### `agent_runs`

Stage 3 persists exactly these fields:

| Column                 | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `id`                   | Flapstack run identity                                        |
| `chat_id`              | owning visible chat                                           |
| `sub_chat_id`          | internal conversation row; nullable after sub-chat deletion   |
| `harness`              | selected harness/provider path                                |
| `model`                | requested or resolved model string when available             |
| `permission_mode`      | immutable requested permission mode for this row              |
| `custom_permissions`   | serialized custom permission toggles when used                |
| `worktree_path`        | launch working tree/path                                      |
| `prompt_message_id`    | durable prompt/idempotency correlation                        |
| `initial_prompt`       | queued MCP/orchestration prompt needed before renderer launch |
| `status`               | `pending`, `running`, or terminal status by convention        |
| `started_at`           | run creation/claim time                                       |
| `completed_at`         | terminal time                                                 |
| `before_checkpoint_id` | pre-run checkpoint                                            |
| `after_checkpoint_id`  | post-run checkpoint                                           |

There is no Agent Runtime, adapter version, protocol version, capability
snapshot, control snapshot, activity sequence, provider thread/turn/item
identity, or privacy classification on `agent_runs` in Stage 3.

### Adjacent identity and content

- `chats` stores scope, harness, model, permissions, worktree/branch data, and
  cross-agent parent/ancestor lineage.
- `sub_chats` stores harness, model, permissions, worktree, run status, the JSON
  message array, `stream_id`, and `session_id`.
- Claude persists its provider session in `sub_chats.session_id` through
  [`src/main/lib/claude/message-persistence.ts`](../../../src/main/lib/claude/message-persistence.ts).
- Codex does not use that column as its resume authority. It reads the last
  assistant message's `metadata.sessionId` in
  [`src/main/lib/trpc/routers/codex.ts`](../../../src/main/lib/trpc/routers/codex.ts).
- Message/tool/reasoning presentation is serialized inside
  `sub_chats.messages`; there is no append-only provider activity table.
- Checkpoints and file manifests reference `agent_runs`, while orchestration
  rows hold only the Flapstack `run_id` link.

Migrations through
[`drizzle/0023_stage3_timestamp_seconds.sql`](../../../drizzle/0023_stage3_timestamp_seconds.sql)
are the frozen Stage 3 schema. Startup repair and rebase behavior lives in
[`src/main/lib/db/migrate.ts`](../../../src/main/lib/db/migrate.ts).

## Every Stage 3 run-creation path

The inventory was produced by searching every `agentRuns` insert and raw
`INSERT INTO agent_runs` in the frozen tree. Test SQL seeds are not production
creation paths.

| Entry                                | Source and symbol                                                                                                         | Initial state                                                     | Transport owner                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| Direct Codex UI/send                 | [`src/main/lib/trpc/routers/codex.ts`](../../../src/main/lib/trpc/routers/codex.ts), `createCodexRun`                     | `running`; reuses an existing queued run ID                       | Codex router -> ACP provider                        |
| Direct Claude UI/send                | [`src/main/lib/trpc/routers/claude.ts`](../../../src/main/lib/trpc/routers/claude.ts), `createClaudeAgentRun`             | `running`; reuses an existing queued run ID                       | Claude router -> Agent SDK                          |
| Direct Cursor UI/send                | [`src/main/lib/trpc/routers/cursor.ts`](../../../src/main/lib/trpc/routers/cursor.ts), `createCursorRun`                  | `running`; reuses an existing run ID                              | Cursor child process                                |
| Direct OpenRouter/NanoGPT UI/send    | [`src/main/lib/trpc/routers/opencode.ts`](../../../src/main/lib/trpc/routers/opencode.ts), `chat` subscription insert     | `running`                                                         | isolated OpenCode sidecar                           |
| MCP launch in an existing chat       | [`src/main/lib/mcp-control/mutation-service.ts`](../../../src/main/lib/mcp-control/mutation-service.ts), `launchRun`      | `pending`, stable ID from chat plus idempotency key               | pending-run scheduler                               |
| MCP spawned thread with launch       | [`src/main/lib/mcp-control/mutation-service.ts`](../../../src/main/lib/mcp-control/mutation-service.ts), `spawnThread`    | optional `pending` row in the same transaction as chat/sub-chat   | pending-run scheduler                               |
| Orchestration worker materialization | [`src/main/lib/agent-orchestration/service.ts`](../../../src/main/lib/agent-orchestration/service.ts), `materializeAgent` | `pending` in the worker chat/sub-chat materialization transaction | pending-run scheduler                               |
| Development test-control probe       | [`src/main/lib/mcp-test-control/service.ts`](../../../src/main/lib/mcp-test-control/service.ts), test chat creation       | synthetic `running` row                                           | dev-only test surface, not product launch authority |

MCP and orchestration pending rows converge at
[`src/main/lib/run-launch-service.ts`](../../../src/main/lib/run-launch-service.ts):
`drainPendingMcpRuns` atomically claims one pending row per sub-chat, then
[`src/main/lib/main-run-launcher.ts`](../../../src/main/lib/main-run-launcher.ts)
calls the same Codex or Claude tRPC procedure used by renderer-driven sends.
Stage 3's main launcher accepts only `codex` and `claude-code` queued runs.

On restart, `recoverInterruptedMcpRuns` moves interrupted MCP rows back to
`pending` and marks other interrupted `running` rows `cancelled`. It does not
resume a provider turn from a durable provider event cursor.

## Source-linked behavioral map

| Concern                     | Frozen path                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness input contract      | [`src/shared/harness-types.ts`](../../../src/shared/harness-types.ts) `RunInput`; [`src/main/lib/harness/types.ts`](../../../src/main/lib/harness/types.ts)                                                                                                                                                                            |
| Provider capability truth   | [`src/main/lib/harness/provider-capabilities.ts`](../../../src/main/lib/harness/provider-capabilities.ts)                                                                                                                                                                                                                              |
| Startup/resume context      | [`src/main/lib/harness/launch-context.ts`](../../../src/main/lib/harness/launch-context.ts); echoed envelopes scrubbed by [`src/shared/harness-envelope-sanitizer.ts`](../../../src/shared/harness-envelope-sanitizer.ts)                                                                                                              |
| Direct launch               | provider tRPC routers plus renderer transports under [`src/renderer/features/agents/lib/`](../../../src/renderer/features/agents/lib/)                                                                                                                                                                                                 |
| Queued launch               | [`src/main/lib/run-launch-service.ts`](../../../src/main/lib/run-launch-service.ts) -> [`src/main/lib/main-run-launcher.ts`](../../../src/main/lib/main-run-launcher.ts)                                                                                                                                                               |
| Session/resume              | Codex message metadata in its router; Claude [`session-options.ts`](../../../src/main/lib/claude/session-options.ts), [`session-recovery.ts`](../../../src/main/lib/claude/session-recovery.ts), and `sub_chats.session_id`                                                                                                            |
| Cancellation                | provider-owned active maps and `cancel` procedures in Codex, Claude, Cursor, and OpenCode routers                                                                                                                                                                                                                                      |
| Shutdown                    | [`src/main/index.ts`](../../../src/main/index.ts) -> [`src/main/lib/app-shutdown.ts`](../../../src/main/lib/app-shutdown.ts): abort all providers, wait up to 10 seconds for finalizers, then close SQLite last                                                                                                                        |
| Permission resolution       | [`src/main/lib/permissions.ts`](../../../src/main/lib/permissions.ts), [`src/main/lib/permission-boundary.ts`](../../../src/main/lib/permission-boundary.ts), Codex [`permission-bridge.ts`](../../../src/main/lib/codex/permission-bridge.ts), Claude `canUseTool`, Cursor args, OpenCode sidecar permissions                         |
| Persistence                 | provider routers -> `sub_chats.messages`; Claude stream ownership in [`message-persistence.ts`](../../../src/main/lib/claude/message-persistence.ts)                                                                                                                                                                                   |
| Settings                    | localStorage-backed atoms in [`src/renderer/features/agents/atoms/index.ts`](../../../src/renderer/features/agents/atoms/index.ts); launch controls in [`chat-input-area.tsx`](../../../src/renderer/features/agents/main/chat-input-area.tsx) and [`new-chat-form.tsx`](../../../src/renderer/features/agents/main/new-chat-form.tsx) |
| Cross-provider continuation | [`active-chat.tsx`](../../../src/renderer/features/agents/main/active-chat.tsx) creates a new internal conversation, writes visible history as an attachment, then applies the target provider                                                                                                                                         |
| Provider/session fork       | [`src/main/lib/trpc/routers/chats.ts`](../../../src/main/lib/trpc/routers/chats.ts) `forkSubChat`; Claude uses `resumeSessionAt` plus `forkSession` when session files and UUID exist                                                                                                                                                  |
| Safe history export         | [`src/main/lib/chat-handoff.ts`](../../../src/main/lib/chat-handoff.ts) and [`src/shared/chat-visible-content.ts`](../../../src/shared/chat-visible-content.ts)                                                                                                                                                                        |
| Shared reasoning contract   | [`src/shared/reasoning-output/`](../../../src/shared/reasoning-output/)                                                                                                                                                                                                                                                                |
| Renderer bridge             | [`assistant-message-item.tsx`](../../../src/renderer/features/agents/main/assistant-message-item.tsx), [`agent-reasoning-output.tsx`](../../../src/renderer/features/agents/ui/agent-reasoning-output.tsx), and [`reasoning-parts.ts`](../../../src/renderer/features/agents/lib/reasoning-parts.ts)                                   |

### Lifecycle boundaries

- Direct provider routers write a running row before provider work, capture a
  before checkpoint, persist partial/final messages, capture an after
  checkpoint/manifest, then conditionally write the terminal status.
- A newer run for the same internal conversation cancels a stale running row or
  aborts the old active owner. Provider maps key ownership by `subChatId` and
  compare run/controller identity before final writes.
- Codex and Claude cancellation abort their controllers; Claude also cancels
  pending structured input. Cursor sends `SIGTERM` then `SIGKILL` after two
  seconds. OpenCode aborts its controller and resolves pending approvals.
- Shutdown stops the pending scheduler, aborts all four provider paths, waits
  for async finalizers to persist cancellation/partial state, then closes the
  database. A timeout reports incomplete shutdown; it does not prove provider
  session reconciliation.
- Provider permissions are resolved from persisted run/chat state before
  launch. They are provider-specific translations, not one durable capability
  snapshot. Stage 4 must not infer permissions from model branding.

## Codex transformation and loss matrix

Frozen transport decision:
[`src/main/lib/harness/codex-transport-decision.ts`](../../../src/main/lib/harness/codex-transport-decision.ts)
selects `codex-acp/app-server`. The installed adapter starts `codex app-server`;
the installed ACP AI provider then converts ACP session updates into AI SDK
stream parts. Flapstack adds a post-turn JSONL poll in
[`src/main/lib/codex/reasoning.ts`](../../../src/main/lib/codex/reasoning.ts).

| Native App Server signal                           | App Server -> ACP `1.1.2`                                                                                                 | ACP -> AI SDK provider `0.3.3`                                                | Flapstack persistence/rendering                                                                                                                | Frozen loss or synthesis                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `threadId`                                         | Becomes ACP `sessionId`; resume uses the same value                                                                       | Exposed through provider `getSessionId()`                                     | Stored in assistant message metadata and recovered from the last assistant message                                                             | Preserved as session identity, not a typed Runtime thread field                                           |
| `turn/started`, `turn/completed`, `turnId`         | Adapter stores `currentTurnId` in memory; normal turn lifecycle emits no ACP transcript event                             | No turn event/ID reaches AI SDK UI parts                                      | No turn ID column or message metadata                                                                                                          | Turn identity and boundaries lost                                                                         |
| `item/started`, `item/completed`, item type/status | Tool-like items become ACP tool calls/updates; agent/reasoning item lifecycle is mostly consumed                          | Tool IDs survive; text/reasoning block lifecycle is regenerated               | Generic tool/message parts                                                                                                                     | Provider item lifecycle is partial; non-tool item type/status is lost                                     |
| Agent message `itemId` and phase                   | Delta becomes `agent_message_chunk` with `messageId=itemId` and optional phase metadata                                   | Provider allocates local `text - N` block IDs                                 | AI SDK/Flapstack message UUID and text part                                                                                                    | Native message item ID is lost; phase is not a durable field                                              |
| `item/reasoning/summaryTextDelta`                  | Becomes `agent_thought_chunk(messageId=itemId)`                                                                           | Provider allocates local `reasoning - N` ID and emits generic reasoning delta | Generic reasoning part/row                                                                                                                     | Summary kind, item ID, and source kind are lost                                                           |
| `item/reasoning/textDelta`                         | Uses the same `agent_thought_chunk` mapping                                                                               | Same generic reasoning delta                                                  | Same generic reasoning presentation                                                                                                            | Raw-vs-summary distinction is lost; displayability cannot be reconstructed                                |
| `summaryIndex`, `contentIndex`                     | Not copied into ACP update                                                                                                | Unavailable                                                                   | Unavailable                                                                                                                                    | Both provider indices lost                                                                                |
| `summaryPartAdded` section boundary                | Synthesized as a literal `"\n\n"` thought chunk                                                                           | Appended to the current local reasoning block                                 | Rendered as text spacing                                                                                                                       | Section identity/index/type lost; paragraph break synthesized                                             |
| Completed reasoning item with no deltas            | Adapter joins `summary[]`, otherwise `content[]`, with double newlines                                                    | Becomes one generic thought block                                             | Generic reasoning part                                                                                                                         | Array element identity and summary/content provenance lost                                                |
| Encrypted/private reasoning                        | Not emitted as visible ACP thought text                                                                                   | No visible AI SDK part                                                        | JSONL normalizer classifies encrypted content opaque, but `codexReasoningEventsToParts` filters it out before message persistence              | Private payload is not rendered or reconstructed; Stage 3 has no durable opaque activity store            |
| Post-turn JSONL reasoning summary                  | Not part of the live ACP stream                                                                                           | N/A                                                                           | Poller selects newest in-window response item, joins visible summary text, and appends a synthetic `tool-ReasoningOutput`; dedup is text-based | Timing/order relative to native events, indices, and item lifecycle are lost; fake tool shape synthesized |
| Plan updates                                       | `turn/plan/updated` maps to ACP plan; `item/plan/delta` is ignored                                                        | Exposed as provider raw plan content, not native item stream                  | Existing generic plan/tool UI                                                                                                                  | Plan item identity/delta boundaries are incomplete                                                        |
| Command/file/MCP/web/image events                  | Selected item kinds map to ACP tool calls/updates; several output/patch delta notifications are ignored                   | Tool calls may be wrapped as the ACP dynamic tool; IDs generally survive      | Tool names/inputs normalized by [`codex-tool-normalizer.ts`](../../../src/shared/codex-tool-normalizer.ts)                                     | Native event kind, per-event timestamps, and unhandled deltas are not durably retained                    |
| Permission request                                 | Native request becomes ACP `session/request_permission`, with original params under ACP `_meta.codex`                     | Flapstack patch routes the request to the permission handler                  | Decision/audit/tool state retained through existing permission code                                                                            | Native request envelope and full lifecycle are not in a provider activity stream                          |
| Usage/warning/compaction/thread status             | Selected signals become ACP usage, message, or session-info updates; many thread/account/hook/realtime events are ignored | Some become generic stream/raw parts                                          | Usage/message metadata or generated prose; no ordered event table                                                                              | Event identity, native kind, and ordering relative to transcript are partial                              |

The exact ignored-event switch and reasoning collapse are visible in the
installed lockfile artifact `node_modules/@agentclientprotocol/codex-acp/dist/index.js`.
That generated dependency file is reproducible from `package-lock.json` but is
not linked here because `node_modules` is not repository content.

## Claude Agent SDK transformation and loss matrix

The native source is the installed Agent SDK query stream. Frozen conversion is
implemented by
[`src/main/lib/claude/transform.ts`](../../../src/main/lib/claude/transform.ts),
then accumulated and serialized by
[`src/main/lib/trpc/routers/claude.ts`](../../../src/main/lib/trpc/routers/claude.ts).

| Agent SDK signal                       | Transformer output                                                                                             | Persisted Stage 3 form                                                 | Frozen loss or synthesis                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`                           | Final/message metadata `sessionId`                                                                             | `sub_chats.session_id` and assistant metadata                          | Preserved for resume; not snapshotted on `agent_runs`                                                                                              |
| Assistant `uuid`                       | Router tracks only the last assistant UUID; injects `sdkMessageUuid` after a successful history-enabled stream | Final assistant metadata                                               | Intermediate message UUIDs and per-block UUID association are lost                                                                                 |
| `stream_event.message_start`           | Resets local text/reasoning state                                                                              | No part                                                                | Native message boundary/ID lost                                                                                                                    |
| Text content block/index/deltas        | Local random `text-<time>-<random>` start/delta/end                                                            | Plain `{type:"text", text}` part                                       | Provider block index and block identity lost; local ID synthesized and not retained in the compact persisted part                                  |
| Thinking block/index/deltas            | `claude-code-<index>` fake `ReasoningOutput` tool input, JSON-fragment deltas, then tool result                | `tool-ReasoningOutput` part                                            | Provider-visible text preserved; native thinking type, signature, message association, and content-block envelope lost; tool lifecycle synthesized |
| Final thinking block                   | Used as fallback only when deltas did not already emit it                                                      | Same fake tool part                                                    | Duplicate suppression is local state, not provider identity persistence                                                                            |
| Tool use ID/name/input                 | `tool-input-*`; child ID becomes `parent_tool_use_id:tool_use_id`                                              | `tool-<name>` with composite `toolCallId`, input, result/output, state | Tool ID survives for root calls; parent lineage is flattened into a string, not a separate durable field                                           |
| Tool result                            | Matches the local mapping, falls back to original tool ID                                                      | Result/output on matching tool part                                    | Native user/tool-result message identity and ordering envelope lost                                                                                |
| `parent_tool_use_id` / subagent stream | Mutable transformer context; composite tool IDs; forwarded text is generic text                                | Generic text/tool parts                                                | Explicit subagent identity, message parentage, and child lifecycle are not durable                                                                 |
| System `init`                          | Ephemeral `session-init` with tools, MCP servers, plugins, skills                                              | Not accumulated into message parts                                     | Native init envelope and capabilities are not persisted with the run                                                                               |
| System compacting/boundary             | Synthetic `Compact` tool call/result                                                                           | Generic tool part                                                      | Status/boundary becomes fake tool activity                                                                                                         |
| Hook events                            | SDK option requests them only when `reasoningEnabled`; transformer has no hook-specific mapping                | No dedicated persisted hook event                                      | Hook kind/payload/lifecycle lost                                                                                                                   |
| Permission/input callback              | Handled out-of-band by Claude `canUseTool` and Agent Input lifecycle                                           | Existing tool/question/audit state                                     | Native callback envelope is not a transcript activity event                                                                                        |
| Result/subtype/cost/usage              | Flattened message metadata plus `finish`                                                                       | Assistant metadata and usage records                                   | Native result envelope, message count, and detailed provenance are partial                                                                         |
| Resume                                 | `resume=session_id`; optional `resumeSessionAt=sdkMessageUuid`                                                 | Driven by `sub_chats.session_id` and assistant flags                   | SDK remains resume authority; no immutable run-level resume snapshot                                                                               |
| Fork                                   | `forkSession=true` plus `resumeSessionAt`; chat router copies visible messages and local session files         | New chat/sub-chat with copied session ID/history                       | File-copy success governs native fork fidelity; provider fork lineage is not a typed run field                                                     |

One Stage 3 `reasoningEnabled` input controls three different provider concerns:

- adaptive summarized thinking versus disabled thinking;
- `forwardSubagentText`;
- `includeHookEvents`.

Effort remains a separate SDK field. Therefore Stage 3 cannot independently
hide thinking while retaining child activity or hook diagnostics.

## Renderer and privacy boundary

[`src/shared/reasoning-output/reasoning-output-contract.ts`](../../../src/shared/reasoning-output/reasoning-output-contract.ts)
classifies visible reasoning text, visible summaries, token-only metadata,
opaque/private data, absent output, and unsupported output. The renderer accepts
native AI SDK `reasoning`, `tool-ReasoningOutput`, and legacy `tool-Thinking`,
normalizes all three to the generic Reasoning Output component, and supplies a
synthetic ID when none survives.

Stage 3 privacy facts:

- Visible provider text and provider-authored summaries may be persisted in
  message JSON and included in safe handoff/search.
- Encrypted/private reasoning must never become visible text. The Codex
  normalizer recognizes it, but Stage 3 has no durable opaque event store.
- Reasoning token counts are usage metadata, not reasoning prose.
- Handoff/export includes visible text, visible reasoning, questions/answers,
  and tool names only; arbitrary tool inputs/outputs and hidden file content are
  excluded by [`chat-visible-content.ts`](../../../src/shared/chat-visible-content.ts).
- Claude development raw logging in
  [`src/main/lib/claude/raw-logger.ts`](../../../src/main/lib/claude/raw-logger.ts)
  writes complete SDK messages when enabled (development defaults on), rotates
  at 10 MiB, and retains files for seven days. Those logs are sensitive local
  diagnostics, are not sanitized fixture provenance, and must never be copied
  into committed fixtures without explicit field-level redaction.

## Automated checks and evidence gaps

| Evidence                            | Frozen result                                                                                                             | What it does not prove                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Exact six-file archive replay       | PASS, 70 tests                                                                                                            | Credentials, live provider protocol drift, renderer pixels, packaged binaries, other OSes |
| Current descendant replay           | PASS, 73 tests                                                                                                            | Same gaps; extra cases are Stage 4 migration coverage                                     |
| Contract/normalizer/transform tests | PASS                                                                                                                      | Full native Codex event identity or full Claude SDK envelope fidelity                     |
| Migration rebase test               | PASS                                                                                                                      | A production user database not represented by fixtures                                    |
| Handoff privacy tests               | PASS                                                                                                                      | Arbitrary future provider payloads or user-installed tools                                |
| Historical Stage 3 matrix           | Records exact-candidate credentialed Codex, Claude, Cursor, OpenRouter, NanoGPT, macOS Dev, and unsigned Preview evidence | This T1 lane did not replay those live/manual/package observations                        |

Explicit gaps for this baseline task:

- No fresh credentialed Codex or Claude call was made. Provider capability and
  protocol drift after the frozen versions remain untested here.
- No raw, sanitized, one-run Codex capture spans App Server -> ACP -> AI SDK ->
  persisted message with matching IDs and indices.
- No raw, sanitized, one-run Claude capture spans init -> thinking -> tool ->
  permission -> hook -> subagent -> result -> persisted message with UUID and
  parent lineage.
- No live UI was opened. Rendering, keyboard, screen-reader, search, copy, and
  visual ordering were not re-observed in this headless lane.
- No package was built or launched for provider fidelity in this lane. Frozen
  Stage 3 historical macOS Preview evidence is not relabeled as a new T1 run.
- Windows and Linux runtime/package behavior remain unverified. Lockfile
  platform packages are not OS evidence.
- Apple signing/notarization and store distribution are outside this baseline.

The fixture manifest in
[`tests/fixtures/agent-runtime/README.md`](../../../tests/fixtures/agent-runtime/README.md)
owns the sanitized capture inventory and missing-capture queue for downstream
adapter parity work.
