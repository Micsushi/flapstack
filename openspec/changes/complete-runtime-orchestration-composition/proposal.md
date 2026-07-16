# Change: Complete Runtime and Cross-Provider Orchestration Composition

## Why

Stage 4 deliberately separates F3 coordination from F11 Agent Runtime
authority. It also correctly treats Codex App Server and the Claude Agent SDK as
different native harnesses with different sessions, protocols, permissions,
events, and capabilities. A Codex model cannot truthfully run inside the Claude
Code Runtime, and a Claude model cannot truthfully run inside the Codex Runtime.

Stage 5 still needs those systems to work together. Users must be able to
continue or delegate work from a Codex Chat to a Claude Code Chat, and in the
other direction, without losing visible context, lineage, permissions, worktree
truth, structured results, usage attribution, cancellation, or recovery. The
current S5-F7 plan covers F3/F11 seams but does not fully specify that
cross-provider composition contract.

## What Changes

- Define an exact execution target as harness, compatible Runtime, provider,
  model, account, Agent Profile, permission mode, and workspace/worktree.
- Enforce native compatibility: Codex never resolves the Claude Code Runtime,
  Claude Code never resolves the Codex Runtime, and no target silently changes.
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
- Affected code: execution-target resolver and compatibility graph, F3 consumer
  ports, F11 coordinator/adapters, Chat lineage and handoff services,
  structured task/result envelopes, permission and worktree policy, activity
  and usage projection, lifecycle recovery, target selectors, diagnostics,
  documentation, and tests.
- Dependencies: fully accepted S4-F3 and S4-F11.
- Downstream: S5 mobile, Agent Profiles, terminal-grid/swarm, performance,
  cross-platform distribution, and integrated release consume this contract.
