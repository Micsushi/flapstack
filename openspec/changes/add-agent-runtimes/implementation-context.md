# S4-F11 Agent Runtime implementation context

This file is the shared pickup packet for every S4-F11 task. It records the
Stage 3 seams, fixed contracts, ownership boundaries, and evidence rules that
must not be rediscovered or changed independently by each task owner.

## Authority and baseline

- All Agent Runtime implementation belongs to Stage 4 feature S4-F11.
- Stage 3 is complete and is an immutable behavioral baseline, not an
  implementation branch for this feature.
- Baseline: clean `codex/stage3-integration` tag `stage3-final`, commit
  `a674784`.
- Implementation starts from the latest clean Stage 4 integration commit after
  that Stage 3 baseline is synchronized.
- `proposal.md` owns scope, `design.md` owns architecture, the delta spec owns
  normative behavior, and `tasks.md` is the sole completion checklist.

## Fixed vocabulary

- UI label: `Runtime`.
- Full product and technical term: `Agent Runtime`.
- Runtime preference: `auto | codex | claude-code | flapstack-native`.
- Resolved runtime: `codex | claude-code | flapstack-native`.
- Internal provider transport contract: `HarnessAdapter`.
- Coordination engine remains separate:
  `workflow | codex-v2 | codex-v1`.
- Agent profile/personality belongs to S4-F12 and cannot replace the runtime
  contract.

## Non-negotiable invariants

1. Resolution order is chat preference, project-per-harness override,
   global-per-harness default, then product mapping.
2. Compatibility is based on harness capability, never model vendor branding.
3. Every run stores an immutable resolved runtime, adapter/protocol versions,
   capability snapshot, and launch controls before provider work begins.
4. No unavailable runtime silently falls back. The user may explicitly choose
   Flapstack Native when compatible.
5. Runtime cannot widen permissions, tools, filesystem, network, secrets, MCP,
   worktree, descendant, budget, or coordination authority.
6. Existing Stage 3 chats and runs read as legacy Flapstack Native without
   rewriting messages or replaying provider work.
7. Displayable provider activity may be preserved. Private, encrypted, or
   unavailable chain-of-thought is never reconstructed or rendered.
8. An empty chat may change runtime in place. A started chat changes runtime by
   creating exactly one new chat/provider session through Continue with Runtime.
9. An active run cannot switch runtime.
10. Each orchestration worker resolves and snapshots its own runtime. The
    orchestration engine does not parse provider streams or own runtime events.

## Stage 3 source map

### Shared contracts and launch authority

- `src/shared/harness-types.ts`: harness IDs, permissions, attachments, and
  `RunInput`.
- `src/main/lib/harness/types.ts`: main-process harness types.
- `src/main/lib/harness/provider-capabilities.ts`: provider capability truth.
- `src/main/lib/harness/launch-context.ts`: new/resumed launch context.
- `src/shared/harness-envelope-sanitizer.ts`: persisted envelope safety.
- `src/main/lib/main-run-launcher.ts`: production run-launch bridge.
- `src/main/lib/run-launch-service.ts`: pending/running/terminal ownership and
  per-subchat serialization.
- `src/main/lib/mcp-control/mutation-service.ts`: MCP-created chats/runs that
  must use the same resolver and snapshot path.

### Persistence and migrations

- `src/main/lib/db/schema/index.ts`: `chats`, `sub_chats`, `agent_runs`,
  orchestration rows, audit rows, checkpoints, and manifests.
- `src/main/lib/db/migrate.ts`: startup repair/backfill behavior.
- `drizzle/`: generated additive migrations and schema journal.
- `src/main/lib/trpc/routers/chats.ts`: chat/subchat creation, session IDs,
  message persistence, resume identity, and chat mutation.

Stage 3 stores harness/model on chats and subchats. `sub_chats.session_id` owns
provider resume identity. `agent_runs` stores harness, model, permission,
worktree, prompt, status, and checkpoints, but has no runtime snapshot.

### Codex path

- `src/main/lib/trpc/routers/codex.ts`: ACP session construction, run lifecycle,
  reasoning filtering/polling, persistence, and terminal state.
- `src/main/lib/harness/codex-transport-decision.ts`: current ACP/App Server
  transport decision.
- `src/main/lib/codex/permission-bridge.ts`: Codex approval/sandbox mapping.
- `src/main/lib/codex/mcp-stdio.ts`: MCP registration.
- `src/main/lib/codex/reasoning.ts`: JSONL reasoning recovery and dedup.
- `src/renderer/features/agents/lib/acp-chat-transport.ts`: renderer transport.

Pinned Stage 3 versions:

- bundled Codex `0.144.1`;
- `@agentclientprotocol/codex-acp` `1.1.2`;
- `@mcpc-tech/acp-ai-provider` `0.3.3`.

Current loss point: Codex App Server emits thread/turn/item identity, separate
summary/content indices, raw/summary deltas, and section boundaries. ACP and the
AI SDK merge or replace parts of that identity before Flapstack receives it.

### Claude Code path

- `src/main/lib/trpc/routers/claude.ts`: Agent SDK query lifecycle, run/session
  ownership, controls, cancellation, and persistence.
- `src/main/lib/claude/transform.ts`: SDK-to-AI-message conversion, including
  synthetic `tool-ReasoningOutput` and parent-tool tracking.
- `src/main/lib/claude/session-options.ts`: resume, resume-at, and fork options.
- `src/main/lib/claude/session-recovery.ts`: missing/stale session handling.
- `src/main/lib/claude/message-persistence.ts`: SDK message UUID persistence.
- `src/main/lib/claude/types.ts`: current message metadata.
- `src/main/lib/claude/raw-logger.ts`: sanitized diagnostics.

Pinned Stage 3 version: `@anthropic-ai/claude-agent-sdk` `0.3.207`; packaged
Claude binary `2.1.207`.

Current loss point: provider-visible thinking becomes a fake reasoning tool.
One `reasoningEnabled` input also controls model thinking, display, subagent
forwarding, and hook events.

### Flapstack Native provider paths

- Codex ACP: `src/main/lib/trpc/routers/codex.ts`.
- Claude transformed pipeline: `src/main/lib/trpc/routers/claude.ts` and
  `src/main/lib/claude/transform.ts`.
- Cursor: `src/main/lib/trpc/routers/cursor.ts`,
  `src/main/lib/cursor/stream.ts`.
- OpenRouter/NanoGPT: `src/main/lib/trpc/routers/opencode.ts` and
  `src/main/lib/harness/opencode-sidecar/`.
- Shared reasoning normalization: `src/shared/reasoning-output/`.

### Renderer, settings, and continuation

- `src/renderer/features/agents/atoms/index.ts`: current localStorage-backed
  per-subchat model/reasoning/fast-mode state.
- `src/renderer/features/agents/main/chat-input-area.tsx`: launch controls.
- `src/renderer/features/agents/main/new-chat-form.tsx`: chat creation.
- `src/renderer/features/agents/main/assistant-message-item.tsx` and
  `messages-list.tsx`: transcript composition.
- `src/renderer/features/agents/ui/agent-reasoning-output.tsx`: current generic
  reasoning row.
- `src/renderer/features/agents/lib/reasoning-parts.ts`: reasoning part helpers.
- `src/renderer/features/settings/settings-search.ts`, `settings-content.tsx`,
  and `components/dialogs/settings-tabs/`: searchable Settings surfaces.
- `src/main/lib/chat-handoff.ts`, `src/shared/chat-visible-content.ts`, and
  `src/renderer/features/agents/lib/export-chat.ts`: visible-history handoff.

### Multi-agent seam

- `src/shared/agent-orchestration.ts`: current coordination contract.
- `src/main/lib/agent-orchestration/service.ts`: Stage 3 lineage, leases,
  control, run materialization, and restart truth.
- S4-F3-T6 owns the future coordination-engine contract.
- S4-F11-T9 owns runtime resolution/registry integration for one worker launch.
- S4-F3 owns workflow scheduling and aggregate activity projection.

## Target shared contracts

T2 fixes the names and public shape before adapter work starts. Later tasks may
extend provider-specific payload unions, but must not independently change these
core meanings:

- `AgentRuntimePreference` and `ResolvedAgentRuntime`;
- `RuntimeCompatibilityResult` with exact supported/unavailable reason;
- `RuntimeCapabilitySnapshot` and version fields;
- `ResolvedRuntimeLaunch` containing harness, model, preference source,
  resolved runtime, controls, permissions, and adapter versions;
- `HarnessAdapter` lifecycle: probe, start/resume session, start turn, stream
  activity, request input/permission, cancel, complete/reconcile, cleanup;
- `AgentActivityEvent` and privacy/display classes;
- resolver and adapter-registry interfaces usable by UI, direct runs, MCP runs,
  and orchestration workers.

## Target durable data

Exact SQL names are finalized by T2/T3, but the stored meanings are fixed:

- runtime defaults keyed by global/project scope plus harness, with optimistic
  version and timestamps;
- chat runtime preference and preference source;
- run resolved runtime, adapter version, protocol version, capability snapshot,
  and launch-control snapshot;
- append-only activity keyed by run with stable Flapstack sequence, provider
  identities/indices, kind/phase, privacy/display class, timestamps, dedup key,
  bounded typed payload, and redaction metadata.

No migration may rewrite historical message JSON or invent provider identity.

## Work-packet ownership

| Task | Exclusive lane                                                         | May run in parallel with            |
| ---- | ---------------------------------------------------------------------- | ----------------------------------- |
| T1   | Baseline contract and fixture inventory                                | None; first gate                    |
| T2   | Shared runtime types, resolver, schema, migrations, DTOs               | None; serial shared seam            |
| T3   | Activity schema, sequencer, storage/query service                      | None; serial shared seam            |
| T4   | Direct Codex adapter modules and Codex fixtures                        | T5, T6                              |
| T5   | Native Claude Code adapter modules and Claude fixtures                 | T4, T6                              |
| T6   | Flapstack Native adapter and legacy compatibility                      | T4, T5                              |
| T7   | Shared transcript/activity renderer                                    | Starts after T4-T6 contracts settle |
| T8   | Settings, chat selector, and continuation UX                           | Starts after T7                     |
| T9   | Central adapter registry, launch bridge, and orchestration-worker seam | Starts after T8 and S4-F3-T6        |
| T10  | Integrated acceptance, diagnostics, docs, live/package proof           | Final gate                          |

T4, T5, and T6 must not edit shared runtime types, activity schema, or each
other's provider directory. If a shared contract is insufficient, the owner
records the missing case and coordinates one small T2/T3-owned amendment before
continuing. T9 is the only task that wires all adapters into the central launch
registry; this prevents three parallel branches from editing the same switch.

## Pickup and handoff contract

Before starting any task:

1. Verify clean task worktree, branch, HEAD, and latest Stage 4 integration base.
2. Confirm every `Blocked by` task is complete in this authoritative board.
3. Read proposal, design, delta spec, this context file, and the selected task.
4. Re-run or inspect the upstream contract tests the task consumes.
5. Do not absorb downstream UI, provider, orchestration, or acceptance work.

Every task handoff must include:

- changed files grouped by owned seam;
- migration/API/type changes and compatibility notes;
- focused commands with pass/fail output;
- fixture provenance and redaction statement;
- live/provider/package evidence actually observed;
- remaining evidence explicitly unverified;
- any downstream integration note needed by the next task.

Do not check a task complete until its acceptance and verification pass. Code
ready with unavailable credentials, UI, OS, or package proof remains unchecked
with the exact evidence blocker recorded.

## Verification commands

Focused tests use the repository runner so Node ABI and the shared heavy-job
lock remain correct:

```bash
npm test -- tests/<focused-file>.test.ts
npm run ts:check
npm run lint
```

Database tasks also run migration fixtures from Stage 3 and the newest schema.
Renderer tasks must ensure test files match `vitest.config.ts`; do not assume a
`.test.tsx` file is collected without proving it. Feature close runs:

```bash
npm run check
npx --yes @fission-ai/openspec@latest validate add-agent-runtimes --strict --no-interactive
npm run dev
npm run dev:verify
npm run package:preview:mac
```

Live development uses only `npm run dev`. Packaged manual testing uses only the
preview package. Unsupported OS, unavailable provider credentials, or locked UI
state stays open rather than being inferred from unit tests.
