## Context

Flapstack has three transport adapters: direct Codex App Server, direct Claude
Agent SDK, and Flapstack Native. The current direct adapters also receive
Flapstack-owned instructions and extension policy. That makes them enhanced
provider adapters even though the UI labels them simply Codex and Claude Code.

Provider parity is bounded by observable public/native behavior. Flapstack
cannot clone undisclosed provider desktop instructions or pixel-identical UIs.
It can preserve the providers' shipped runtime presets, model-catalog
instructions, native instruction-file discovery, local settings, tools,
sessions, events, permissions, and controls while avoiding Flapstack prompt
additions.

## Goals / Non-Goals

### Goals

- Separate provider-parity and Flapstack-enhanced behavior explicitly.
- Reuse one native transport adapter per provider.
- Snapshot the exact selected behavior on every run.
- Keep Flapstack Native stable for generic providers and rollback.
- Prevent silent fallback or in-place session behavior changes.

### Non-Goals

- Claiming parity with undisclosed provider desktop/server instructions.
- Duplicating Codex App Server or Claude Agent SDK protocol implementations.
- Changing model weights or private reasoning.
- Running a provider through another provider's native protocol in Stage 4.
- Implementing Stage 5 cross-provider adapters in this change.

## Decisions

### Preferences and adapters are separate axes

```text
runtimePreference = auto
                  | codex | codex-enhanced
                  | claude-code | claude-code-enhanced
                  | flapstack-native

resolvedRuntime   = codex | claude-code | flapstack-native
```

`codex` and `codex-enhanced` both resolve to the Codex adapter.
`claude-code` and `claude-code-enhanced` both resolve to the Claude adapter.
The immutable `runtime_preference` records parity versus enhanced behavior;
`resolved_runtime` records the actual transport owner.

Automatic inherits project and global defaults, then selects provider parity for
new Codex and Claude Code Chats. The first provider launch pins that concrete
preference on the Chat and run. Existing explicit direct settings, started
Automatic direct Chats, and their ambiguous historical run preference labels
migrate to the matching Enhanced preference so resume behavior does not silently
change. Transport, messages, events, and provider identities remain unchanged.
Existing Flapstack Native settings remain unchanged.

### Provider-parity launch policy

Codex parity:

- launches the pinned Codex App Server;
- lets Codex resolve model-catalog base instructions and native `AGENTS.md`;
- passes model, effort, permission/sandbox, cwd, and provider-native config;
- does not pass Flapstack `developerInstructions` or managed hook/skill/MCP
  filtering.

Claude Code parity:

- uses the Claude Agent SDK with `systemPrompt: claude_code`;
- enables `settingSources: [user, project, local]` so native `CLAUDE.md` and
  settings discovery match Claude Code behavior;
- passes model, effort, permission, cwd, tools, sessions, and native events;
- does not append Flapstack startup/vault instructions or managed extension
  filtering/hooks.

Flapstack still owns its UI, durable Chat/run/activity storage, permission
bridge, cancellation, and safety boundaries. These host responsibilities do
not imply prompt parity with a closed provider desktop UI.

### Enhanced launch policy

Enhanced modes use the same native adapter and add the existing Flapstack
startup bundle, project vault context, response behavior, managed extension
policy, managed hooks, and filtered MCP/skills configuration.

### Switching and persistence

An empty Chat may change preference in place. Automatic remains visible until the
first send, then changes to the concrete inherited or product preference. After
provider intent, changing between parity, enhanced, or Native creates a new
Chat/session through the existing continuation flow. Comparing only
`resolved_runtime` is insufficient; continuation checks also compare the
immutable requested preference.

### Stage 5 cross-provider adapters

Stage 5 will replace the hard harness/Runtime matrix with a versioned
capability graph. A cross-provider adapter may translate prompts, instruction
files, tools, permissions, events, sessions, and structured output into another
Runtime's contract. Every combination must advertise exact losses and block
unsupported required capabilities. It must never claim native parity, forward
credentials/private reasoning, or silently substitute a target.

## Risks / Trade-offs

- Provider behavior changes over time. Pin versions, capture fixtures, and
  compare live behavior without claiming exact nondeterministic text equality.
- Parity still runs inside Flapstack. Label it provider parity, not provider UI
  identity.
- Enhanced and parity share adapters, so policy branching must be immutable and
  heavily tested to prevent instruction leakage.

## Migration Plan

1. Expand stored Runtime preference constraints and relabel existing direct
   behavior as Enhanced without changing transport/history/provider identity.
2. Map enhanced preferences to existing native adapters.
3. Make direct launch context conditional on enhanced preference.
4. Add selectors, labels, diagnostics, and continuation enforcement.
5. Run focused migration/resolver/prompt-policy/UI tests.
6. Keep provider live/package acceptance open until observed on exact versions.

Rollback disables the enhanced choices and restores previous defaults. Stored
snapshots remain readable because enhanced preferences resolve to existing
transport identities.
