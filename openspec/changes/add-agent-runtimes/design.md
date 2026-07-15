## Context

The implementation baseline is committed Stage 3 branch
`codex/stage3-integration` at the clean `stage3-final` tag, `a674784`.

Stage 3 already provides:

- durable `chats`, `sub_chats`, and `agent_runs` rows with harness/model identity;
- provider-specific tRPC launch paths, permissions, cancellation, session IDs,
  worktrees, checkpoints, usage, and restart reconciliation;
- per-chat model/reasoning preferences in renderer storage;
- a shared `ReasoningOutputEvent` and synthetic `tool-ReasoningOutput` bridge;
- Codex through `codex-acp` -> Codex App Server -> AI SDK;
- Claude Code through the Claude Agent SDK and a Flapstack transformer;
- cross-provider continuation by creating a new conversation with exported
  visible history.

The important losses are also concrete:

- Codex App Server emits thread/turn/item identity, summary and content indices,
  separate summary/raw deltas, and section boundaries. ACP merges those into
  `agent_thought_chunk`; the AI SDK assigns a local reasoning ID; Flapstack then
  renders a generic reasoning row and polls session JSONL for a final summary.
- Claude thinking deltas are live, but the transformer represents them as a
  fake tool. `reasoningEnabled` also controls thinking, subagent forwarding, and
  hook events together.
- global and per-chat tuning lives partly in renderer local storage rather than
  one durable launch-resolution contract.

`Agent Runtime` is separate from the Stage 4 coordination engine:

- runtime answers how one agent communicates, resumes, emits events, and renders;
- coordination engine answers how multiple agents are scheduled and cooperate.

One workflow may therefore contain a Codex-runtime worker, a Claude Code-runtime
worker, and a Flapstack-native local worker.

## Goals / Non-Goals

- Goals: native first-party harness fidelity, deterministic runtime selection,
  durable event provenance, safe switching, independent controls, mixed-runtime
  orchestration, restart recovery, and a stable compatibility path.
- Non-goals: exposing private chain-of-thought, cloning closed desktop UI,
  enabling a native runtime for a model reached through an incompatible
  provider, replacing Flapstack permissions/audit, changing the model itself,
  or maintaining three unrelated chat applications.

## Decisions

### Naming and two independent axes

The product/technical concept is `Agent Runtime`; the short user-facing control
label is `Runtime`. Internal transport implementations are `HarnessAdapter`s.

```text
coordinationEngine = workflow | codex-v2 | codex-v1
agentRuntime       = codex | claude-code | flapstack-native
runtimePreference  = auto | codex | claude-code | flapstack-native
```

`mode` and `profile` are not used. Mode is already overloaded; profile belongs
to S4-F12 capability/personality definitions.

### Resolution and compatibility

Runtime preference resolves once for a chat/run in this order:

1. explicit chat preference;
2. project per-harness override;
3. global per-harness preference;
4. product mapping: Codex harness -> `codex`, Claude Code harness ->
   `claude-code`, everything else -> `flapstack-native`.

Resolution is keyed by harness, not model vendor. An OpenAI model through
OpenRouter remains `flapstack-native`; an Anthropic model outside the Claude Code
harness does not gain Claude Code runtime semantics.

Compatibility is explicit:

| Harness                                                          | Allowed runtimes                  |
| ---------------------------------------------------------------- | --------------------------------- |
| `codex`                                                          | `codex`, `flapstack-native`       |
| `claude-code`                                                    | `claude-code`, `flapstack-native` |
| `cursor-agent`, `openrouter`, `nanogpt`, `local`, future generic | `flapstack-native`                |

Unavailable choices remain visible with a reason. Launch never silently changes
runtime. The resolved runtime, adapter/protocol version, harness, model, and
controls are snapshotted on `agent_runs` before transport work begins.

### Durable settings and migration

Add a versioned `agent_runtime_defaults` table keyed by scope (`global` or
`project`), optional scope ID, and harness. Add chat preference/resolution fields
and non-null run snapshot fields. Keep current renderer atoms only as temporary
UI caches; main-process records are authoritative.

Existing chats and runs are not reinterpreted. Historical and in-progress Stage
3 work reads as `flapstack-native` with a legacy adapter version. No reasoning
events are backfilled unless identity and ordering are lossless; existing
message parts remain renderable through the compatibility bridge.

### Adapter contract

Every adapter implements the same bounded lifecycle:

```text
probe -> start/resume session -> start turn -> stream activity
      -> request permission/input -> cancel -> complete/reconcile
```

The contract returns capability metadata and provider identities but never owns
Flapstack permission, audit, worktree, checkpoint, or run status authority.
Intent is persisted before provider actions. Restart reconciles uncertain state;
it does not replay an uncertain turn or spawn.

### Codex runtime

`codex` uses a direct, pinned Codex App Server JSON-RPC adapter. It preserves:

- initialize/account/model/capability negotiation;
- thread start/resume/fork/archive identity;
- turn start/cancel/completion identity;
- item started/completed lifecycle;
- agent message, plan, reasoning summary, reasoning text, section, tool,
  command, patch, permission, usage, warning, and compaction events;
- thread, turn, item, summary index, and content index;
- native session recovery and protocol drift detection.

The existing ACP/AI SDK Codex path remains the `flapstack-native` compatibility
adapter. This makes rollback and A/B parity testing possible. A hybrid transport
that sends through ACP but separately taps App Server events is rejected because
it creates duplicate ordering and ownership problems.

Raw reasoning is shown only when Codex marks it displayable. Hosted-model hidden
chain-of-thought remains unavailable. Provider-authored summaries remain labeled
`Reasoning summary`.

### Claude Code runtime

`claude-code` continues to use the installed Claude Agent SDK but removes the
lossy presentation conversion. The adapter preserves system/init, stream event,
assistant, result, tool, permission, hook, usage, session, message UUID,
`parent_tool_use_id`, and subagent provenance.

Split the current combined switch into independent values:

- model thinking/effort;
- reasoning display;
- subagent text/activity forwarding;
- hook diagnostics.

Claude provider-visible thinking stays a reasoning block, not a fake tool. The
SDK remains authoritative for resume/fork semantics; Flapstack remains
authoritative for chat/run lineage and permissions.

### Flapstack Native runtime

`flapstack-native` keeps the Stage 3 normalized AI SDK/message pipeline and
supports every harness. It is the only runtime for generic providers and the
fallback selected by the user, never a silent fallback selected by the system.

The synthetic `tool-ReasoningOutput` part remains a legacy renderer bridge until
all current persisted messages can render through the new activity timeline.

### Activity envelope and persistence

Add append-only `agent_activity_events` keyed by run with stable sequence. The
typed envelope includes:

- runtime, harness, provider, chat, subchat, run, and optional orchestration agent;
- provider session/thread, turn, item, parent-item, message, and tool IDs;
- kind, phase, sequence, provider timestamp, received timestamp;
- summary/content/part indices and section boundary;
- display class (`summary`, `provider-visible`, `status`, `tool`, `private`,
  `metadata`) and provenance;
- text or redacted typed payload, never plaintext private/encrypted reasoning.

Adapters append through one run-scoped sequencer. Duplicate provider events use
stable identity keys; out-of-order deltas remain ordered by persisted sequence
and retain provider indices for reconstruction. Large payloads are bounded.

### UI and switching

Use one shared transcript and activity timeline. Runtime-specific formatters
control only native semantics:

- Codex: live reasoning/status heading, sectioned summaries, plan/item timeline;
- Claude Code: thinking summary, tools, permissions, hooks, and subagent activity;
- Flapstack Native: current generic reasoning/tool presentation.

Settings shows a per-harness runtime table. New Chat shows `Agent Runtime` under
provider/model tuning, defaulting to `Automatic`. Chat details shows the resolved
runtime and adapter version.

An empty chat may change runtime in place. After the first provider turn, change
becomes `Continue with <runtime>`: create a new sidebar chat/provider session,
attach/export visible history through the existing continuation path, and retain
the source chat unchanged. Active runs cannot switch. Orchestrated agents resolve
and snapshot runtime independently.

### Safety and truthfulness

- Runtime never expands tools, filesystem, network, secrets, MCP, or descendant
  authority.
- Generated progress prose is `Activity summary`, never `Reasoning`.
- Unsupported/private reasoning says unavailable; it is not reconstructed.
- Unknown native events are persisted as bounded metadata and fail closed when
  they affect execution or permission semantics.
- Provider versions and capability snapshots are visible in diagnostics.

## Risks / Trade-offs

- Direct Codex App Server support duplicates some ACP transport work. Mitigate by
  sharing Flapstack launch, permission, MCP, persistence, and rendering contracts;
  keep direct code limited to protocol translation.
- Native protocols drift. Pin tested versions, capability-probe at launch, keep
  golden fixtures, and block unknown execution-critical events.
- More activity can overload the renderer. Batch deltas, virtualize history,
  bound payloads, and default completed reasoning sections to collapsed.
- Runtime switching can imply continuity that does not exist. Always create a
  new provider session/chat branch and label imported history as context.
- Exact text cannot be parity-tested across nondeterministic model runs. Test
  event-contract preservation using captured fixtures, then perform live
  semantic walkthroughs.

## Migration Plan

1. Add runtime types, compatibility matrix, defaults, chat preference, run
   snapshot, activity table, and additive migrations.
2. Read all legacy rows as `flapstack-native`; do not rewrite message history.
3. Ship resolver and Flapstack Native adapter first so behavior is unchanged.
4. Add Claude Code native fidelity behind a capability flag.
5. Add direct Codex runtime behind protocol/version capability checks.
6. Enable `auto` defaults for new chats only after each native runtime passes
   fixture, restart, live, and package gates.
7. Expose per-project and per-chat selection plus `Continue with runtime`.

Rollback changes new defaults to `flapstack-native` and disables native adapter
selection. It does not delete runtime snapshots, activity events, chats, runs,
or provider session IDs.

## Open Questions

None block implementation. S4-F12 agent capability/personality profiles may
carry a runtime preference, but cannot bypass compatibility, permissions, or
the immutable run snapshot.
