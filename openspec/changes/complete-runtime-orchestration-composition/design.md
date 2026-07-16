## Context

F11 alone owns Runtime selection, provider process/protocol, native sessions,
controls, and native activity. F3 owns workflow scheduling, coordination,
policy, dependencies, and projections. Stage 4 already supports mixed-runtime
workers and safe cross-provider continuation by creating a new Chat with visible
history context.

The word compatible has two different meanings that must not be conflated:

1. **Native execution compatibility** means a harness can use a Runtime that
   actually implements its protocol. Codex App Server and Claude Agent SDK are
   not interchangeable.
2. **Cross-provider composition** means independent native targets can exchange
   bounded context, delegated tasks, structured results, controls, and lineage
   through Flapstack-owned contracts.

Stage 5 implements the second without pretending the first is universal.

## Goals / Non-Goals

### Goals

- Exact, previewable execution-target resolution with no silent substitution.
- Bidirectional Codex and Claude Code continuation and delegation.
- One durable Chat per addressable provider thread/agent identity.
- Versioned task/result envelopes that preserve bounded visible context,
  artifacts, structured output, lineage, usage, and limitations.
- One provider authority, truthful capabilities, permission ceilings, ordered
  activity, cancellation, restart recovery, and no replay.
- A shared UX that explains what will run, where, with what authority, and why a
  requested combination is unavailable.

### Non-Goals

- Making the Claude Agent SDK execute Codex/OpenAI models.
- Making Codex App Server execute Claude/Anthropic models.
- Sharing or converting native provider sessions between harnesses.
- Copying private/encrypted reasoning, credentials, approval grants, raw
  provider state, or hidden tool state into another provider.
- Treating imported history as native conversation history.
- Prompt-only imitation of unsupported structured output or controls.
- Silent Runtime, model, provider, account, permission, or worktree fallback.
- A universal adapter that flattens away provider-specific semantics.

## Decisions

### Exact execution target and compatibility graph

Every launch resolves and snapshots one `ExecutionTarget` before provider
intent:

```text
ExecutionTarget = {
  harness, runtime, provider, model, account,
  agentProfileVersion, permissionMode,
  workspace, worktree, capabilitySnapshot, adapterVersion
}
```

The compatibility graph is versioned and capability-probed. Product defaults:

| Harness          | Valid Runtime choices                                     | Invalid native cross-wiring  |
| ---------------- | --------------------------------------------------------- | ---------------------------- |
| Codex            | Codex; explicit Flapstack Native compatibility path       | Claude Code Runtime          |
| Claude Code      | Claude Code; explicit Flapstack Native compatibility path | Codex Runtime                |
| Generic provider | Flapstack Native                                          | Codex or Claude Code Runtime |

`Automatic` resolves only within the selected harness's valid set. Explicit
selection that becomes unavailable blocks before mutation and offers reviewed
repair choices; Flapstack never changes the stored preference silently.

### Two cross-provider operations

**Continue with target** is user-directed conversation continuation. It creates
a new child Chat, new native provider session, and lineage edge from the source
Chat. The source remains unchanged. A bounded export of user-visible history is
attached as imported context with source Chat/run IDs, content digest, selected
scope, omissions, and timestamp.

**Delegate to target** is a bounded task activation. A direct delegation creates
or activates a distinct child Chat/run. A workflow step references that same
durable child identity. The child returns a typed result envelope; the parent
does not absorb the child's native provider session or pretend the response was
generated in the parent Runtime.

A provider-native transient event without a separately addressable conversation
remains activity in the owning Chat. A provider-exposed distinct child thread or
session materializes a child Chat, consistent with project Chat terminology.

### Versioned composition envelopes

F3 sends F11 a versioned provider-neutral task envelope after the target and
policy are resolved:

```text
CrossProviderTaskEnvelope = {
  version, idempotencyKey, mode,
  initiatorChatId, parentChatId, ancestorChatIds,
  targetSnapshot, objective,
  visibleContextManifest, fileAndArtifactRefs,
  requiredCapabilities, outputSchema,
  permissionCeiling, descendantCeiling,
  budgetCeiling, worktreeLease, deadline
}

CrossProviderResultEnvelope = {
  version, childChatId, runId, targetSnapshot,
  status, structuredOutput, visibleSummary,
  artifactAndChangeRefs, checkpointRefs,
  usageProvenance, limitations, warnings,
  terminalEvidence
}
```

Envelopes reference durable artifacts instead of embedding unbounded payloads.
They exclude plaintext secrets, raw credentials, private/encrypted reasoning,
provider session files, hidden tool state, and unreviewed local files. Context
selection is previewable and auditable. Imported context is labeled as context,
not replayed as native messages.

Required structured output is capability-gated and forwarded through the
matching Runtime. Unsupported required schemas block before worker claim.
Invalid or absent required output cannot satisfy a workflow barrier. Optional
output remains optional, and repair/retry creates a new explicit attempt.

### Ownership and launch sequence

1. F3 resolves workflow policy, requested target, dependencies, and ceilings.
2. The compatibility broker probes the exact target and returns capabilities or
   exact repair choices.
3. Flapstack previews target, context, permissions, worktree, descendants,
   budget, and provider/account boundary when user approval is required.
4. Durable Chat lineage, run reservation, target snapshot, context manifest,
   idempotency key, and launch intent are persisted atomically.
5. F11 alone starts/resumes the native provider session and streams activity.
6. F3 stores references/high-water marks plus workflow-only events; it does not
   create a second provider client/parser or duplicate native activity rows.
7. F11 reconciles provider terminal state. F3 validates the result envelope and
   advances workflow barriers only from durable accepted output.

The existing Codex V1/V2 coordination engines consume versioned F11 ports. They
do not open a second App Server process or own a second event stream.

### Capability negotiation and repair

Capabilities are target-specific, versioned, and persisted with the run. They
include session start/resume/fork, structured output limits, tool input,
attachments, cancellation, pause/resume, activity kinds, permissions, MCP,
hooks, skills, descendants, worktrees, checkpoints, and usage detail.

The UI derives choices from the graph and live probe:

- compatible targets are selectable;
- incompatible targets are absent from ordinary selection or disabled with an
  exact reason in diagnostics/repair views;
- capability drift after preview invalidates the preview and requires repair;
- unknown execution-critical capabilities fail closed;
- no fallback is performed after launch intent.

### Permission, secret, budget, and worktree boundaries

The child effective authority is the intersection of the initiator's delegation
ceiling, selected Agent Profile ceiling, target provider capability, project
policy, and any approved per-launch narrowing. Cross-provider composition never
forwards the source provider's credentials or session grants.

Changing provider account, permission class, network/tool scope, descendant
depth, budget, workspace, or worktree requires the same preview/approval policy
as a direct launch. A child can narrow authority but cannot inherit more than
the parent was allowed to delegate.

Worktree selection is explicit. Shared-worktree delegation requires a durable
lease and conflict policy. Isolated worktree delegation records base, path,
owner, and cleanup authority. Results reference diffs/checkpoints; they do not
auto-merge, commit, push, deploy, or delete a worktree.

### Activity, controls, usage, and recovery

F11 native activity remains authoritative. Cross-provider projections merge
activity by durable references and add only Flapstack-owned delegation,
dependency, approval, context-import, result, and warning events. Every event
retains Chat/run/Runtime/provider/account/task-path provenance.

Pause/resume appears only when the exact target supports it. Cancellation intent
is persisted before signaling children and reconciles after restart. Terminal
compare-and-set wins races. An uncertain provider state is visible and never
auto-replayed. A retry is a new attempt with a new idempotency key while retaining
lineage to the prior attempt.

Usage and cost are attributed to the actual child provider/account/model/Runtime
snapshot. Parent workflows aggregate referenced child usage without copying or
double counting it. Missing provider usage remains unknown, never estimated as
fact.

### User experience

The Runtime selector remains harness-compatible. Cross-provider actions are
separate and explicit:

- `Continue with Claude Code`
- `Continue with Codex`
- `Delegate to Claude Code`
- `Delegate to Codex`

Before launch, the target preview shows provider/harness, Runtime, model,
account, Agent Profile, permission, worktree, context included/omitted,
descendant/budget limits, and unavailable capabilities. After launch, both Chats
show lineage and navigation. Parent activity shows child status and a result
reference, while native details remain in the child Chat.

Diagnostics show compatibility graph version, adapter/provider versions, probe
result, resolved target snapshot, context manifest digest, approvals, and exact
failure/repair reason without exposing secrets.

## Failure Model

- **Incompatible target:** block before Chat/run mutation unless the user selects
  a reviewed alternative.
- **Capability changes after preview:** expire preview and resolve again.
- **Failure before provider intent:** reservation may be safely released.
- **Failure after uncertain provider intent:** reconcile; never auto-relaunch.
- **Child terminal without valid required output:** child remains terminal, but
  the workflow barrier fails and records validation evidence.
- **Partial group control:** persist one result per target; successful siblings
  are not rolled back.
- **App restart during delegation/cancellation:** resume reconciliation from
  durable intent, exact attempt, activity high-water, and provider identity.
- **Missing/deleted source Chat:** retain immutable lineage IDs and imported
  context manifest; mark navigation stale instead of reparenting.

## Migration Plan

1. Add versioned target, capability, envelope, lineage, context-manifest, usage
   reference, and lifecycle fields additively.
2. Read existing Stage 4 runtime snapshots and continuation branches unchanged;
   no history or provider session is rewritten.
3. Introduce the compatibility broker and diagnostics with cross-provider
   actions disabled.
4. Route Codex coordination through F11's single App Server authority.
5. Enable continuation using the existing visible-history exporter under the
   new manifest/audit contract.
6. Enable direct delegation, then workflow delegation, behind capability gates.
7. Enable target preview and both provider directions only after contract,
   privacy, restart, live credential, and package evidence pass.

Rollback disables new cross-provider actions and leaves all child Chats, runs,
lineage, target snapshots, context manifests, results, activity, and usage
readable. It never folds child history back into the source Chat.

## Verification Strategy

- Resolver and compatibility fixtures cover valid/invalid harness, Runtime,
  provider, model, account, profile, permission, and worktree combinations.
- Contract tests cover both envelope versions, size/privacy limits, artifact
  references, structured-output validation, idempotency, and migration.
- Lifecycle fault injection covers reservation, provider-intent, activity,
  result, terminal, cancellation, pause/resume, and restart crash windows.
- Security tests prove no credential, private reasoning, hidden tool state, or
  unselected file enters context, logs, diagnostics, audit, or exports.
- Live tests cover Codex to Claude Code and Claude Code to Codex continuation and
  delegation, mixed workflows, cancellation, restart, incompatible repair, and
  usage attribution.
- Verified Dev and macOS preview package are required here; Windows/Linux native
  parity is repeated by S5-F10 before public support claims.
