# Change: Complete Runtime and Cross-Provider Orchestration Composition

## Why

Stage 4 deliberately separates F3 coordination from F11 Agent Runtime
authority. It also correctly treats Codex App Server and the Claude Agent SDK as
different native harnesses with different sessions, protocols, permissions,
events, and capabilities. Stage 6 must preserve that native truth while adding
explicit translated adapters that let other providers consume a Runtime
contract where capabilities can be mapped honestly.

Stage 6 still needs those systems to work together. Users must be able to
continue or delegate work from a Codex Chat to a Claude Code Chat, and in the
other direction, without losing visible context, lineage, permissions, worktree
truth, structured results, usage attribution, cancellation, or recovery. The
current S6-F7 plan covers F3/F11 seams but does not fully specify that
cross-provider composition contract.

## What Changes

- Define an exact execution target as harness, compatible Runtime, provider,
  Runtime mode, adapter chain, model, account, Agent Profile, permission mode,
  and workspace/worktree.
- Distinguish `native`, `enhanced`, and `translated` execution so the UI never
  presents a translated contract as the provider's native harness.
- Add capability-gated Runtime adapter packs so any provider/model may request
  Codex, Claude Code, or Flapstack Native behavior where required prompt, tool,
  permission, session, event, and output semantics can be translated.
- Add two explicit cross-provider operations:
  - **Continue with** creates a new child Chat/provider session with bounded,
    visible source history as imported context.
  - **Delegate to** creates or activates a distinct child Chat/run and returns a
    typed result to the initiating Chat/workflow.
- Route all provider-native launch and coordination requests through F11's
  owned Runtime authority while F3 owns scheduling, policy, and projections.
- Add versioned provider-neutral task and result envelopes, capability
  negotiation, structured-output propagation, and exact unavailable reasons.
- Apply permission, secret, descendant, budget, worktree, and approval ceilings
  across provider boundaries without credential forwarding.
- Reconcile ordered activity, usage/cost provenance, cancellation, pause/resume,
  restart, uncertain state, and no-replay across parent and child Chats.
- Add target preview, lineage, repair, and diagnostics UI, then prove both
  Codex-to-Claude and Claude-to-Codex paths in verified Dev and package builds.

## Impact

- Affected specs: `runtime-orchestration-composition`.
- Affected code: execution-target resolver and versioned capability graph,
  provider/Runtime adapter broker, F3 consumer ports, F11 coordinator/adapters,
  Chat lineage and handoff services,
  structured task/result envelopes, permission and worktree policy, activity
  and usage projection, lifecycle recovery, target selectors, diagnostics,
  documentation, and tests.
- Dependencies: fully accepted S4-F3 and S4-F11.
- Downstream: S6 mobile, Agent Profiles, terminal-grid/swarm, performance,
  cross-platform distribution, and integrated release consume this contract.
