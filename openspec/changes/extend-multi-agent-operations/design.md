## Context

Stage 3 already owns the durable orchestration envelope: task ownership, agent
definitions, dependency and spawn lineage, queueing, parallel/depth limits,
budgets, stop conditions, worktree strategy, permissions, chat/run materialization,
retry/replace/add, pause/resume/stop, and restart reconciliation. Stage 4 extends
that service with selectable coordination engines and fleet/workspace UX.
Provider-native launch and activity fidelity belongs to `add-agent-runtimes`;
this feature consumes that runtime contract and does not build a second
scheduler or provider transport.

Research snapshot used for this design:

- OpenAI Codex `d7ba5ff9553a` (Apache-2.0): Rust core, CLI/TUI, protocol, and
  app-server are available. The native Codex desktop shell is not in that repo.
- Anthropic Claude Code `988b3e564327` (all rights reserved): public repository
  artifacts and official documentation are behavioral references, not reusable
  core source.
- Oh My OpenAgent `bb0f6fbb69ca` (Sustainable Use License): team/mailbox,
  category, worktree, and harness-adapter patterns are research references only.
- Everything Claude Code `ed387446052d` (MIT): agent/skill/workflow separation
  and its schema-checked workflow pilot are reusable concepts; no source copy is
  required for this feature.

Primary reference pointers:

- Codex V1/V2 tool schemas and activity protocol:
  <https://github.com/openai/codex/blob/d7ba5ff9553a6aa0898a8e3bd5cb3bc00d0c9ddf/codex-rs/core/src/tools/handlers/multi_agents_spec.rs>,
  <https://github.com/openai/codex/blob/d7ba5ff9553a6aa0898a8e3bd5cb3bc00d0c9ddf/codex-rs/app-server-protocol/src/protocol/event_mapping.rs>
- Claude dynamic workflows, subagents, teams, and agent view:
  <https://code.claude.com/docs/en/workflows>,
  <https://code.claude.com/docs/en/sub-agents>,
  <https://code.claude.com/docs/en/agent-teams>,
  <https://code.claude.com/docs/en/agent-view>
- Oh My OpenAgent and Everything Claude Code snapshots:
  <https://github.com/code-yeongyu/oh-my-openagent/tree/bb0f6fbb69ca8361b95f7d564d164c25b1396bc9>,
  <https://github.com/affaan-m/everything-claude-code/tree/ed387446052dfbc6b52de149406b70efa65edc59>

## Goals / Non-Goals

- Goals: a user-selectable coordination engine, deterministic workflow default,
  Codex V2 and V1 compatibility modes, durable operation workspaces, fleet
  visibility, rich navigation, policy editing, cascading control, restart
  recovery, reusable safe definitions, and honest aggregated agent activity.
- Non-goals: a second scheduler, hosted swarm service, hidden delegation,
  unlimited spawning, cross-project authority by default, copying proprietary
  Claude Code internals, exposing private chain-of-thought, or shipping an
  uncurated marketplace of personality prompts.

## Comparative Findings

| Surface                  | Strengths                                                                                                                                                                                        | Weaknesses                                                                                                                        | Flapstack lesson                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Flapstack Stage 3        | SQLite-authoritative task/agent/chat/run lineage; heterogeneous Codex and Claude workers; dependencies, worktrees, permissions, budgets, and restart recovery                                    | One fixed graph scheduler; no engine identity, mailbox, workflow script, operation workspace, or provider-fidelity activity model | Keep this as the durable control plane and add engines as adapters                                         |
| Codex V1                 | Small ID-based lifecycle: spawn, send/interrupt, wait for final result, resume, close                                                                                                            | Weak human identity and topology; parent waits pull results; legacy surface                                                       | Advanced compatibility only; never the new default                                                         |
| Codex V2                 | Named task tree, canonical paths, selective context forking, queued messages, follow-up turns, interruption without destruction, mailbox delivery, list/status, and unloadable completed workers | Provider-specific; evolving feature surface; task-tree control flow still lives in model turns                                    | Adopt names, mailboxes, selective context, reusable idle workers, and residency concepts behind an adapter |
| Claude subagents         | Scoped agent definitions, tool/model/permission limits, worktree isolation, reusable roles, context isolation                                                                                    | A few delegated tasks still report into an LLM context; not a large deterministic workflow                                        | Use for agent profile concepts, not as the default orchestration controller                                |
| Claude agent teams       | Peer sessions, shared task list, direct teammate messaging, lead supervision, direct user steering                                                                                               | Coordination/token overhead; experimental; transient team state; model-led control                                                | Use its interactive collaboration ideas for the fleet/workspace surface                                    |
| Claude dynamic workflows | Script owns loops, branching, barriers, intermediate variables, schemas, concurrency, resumability, and final synthesis; conversation stays responsive                                           | No mid-run user input except permissions; provider implementation is closed; large runs can be costly                             | Make a provider-neutral deterministic workflow engine the Flapstack default                                |
| Oh My OpenAgent          | Harness-neutral core/adapters, category-to-model routing, mailbox/tasklist/worktree primitives, atomic state, explicit prompt-injection gate                                                     | Large prompt/hook surface, rigid model-persona coupling, file-state fragmentation, non-permissive license                         | Reuse boundaries and invariants, avoid copying code or accumulating hook magic                             |
| Everything Claude Code   | Separates agents, skills, rules, hooks, and workflow scripts; schema-validates agent output; uses explicit barriers and fail-closed verification                                                 | Very large catalog can drift, duplicate, and overwhelm discovery; much orchestration remains prompt-defined                       | Keep a small typed profile model and make workflow control flow executable and inspectable                 |

## Decisions

### One durable envelope, several coordination engines

`task_orchestrations` and `orchestration_agents` remain authoritative. Every
engine records intent and identity there before provider work starts. Provider
thread IDs, workflow run IDs, mailbox messages, and script checkpoints are
mapped records beneath that envelope. Fleet, graph, workspace, and transcript
views are projections, not independent control planes.

The stored engine keys and user labels are:

| Stored key | Settings label            | Purpose                                                                                                            | Availability                                                  |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `workflow` | Workflow                  | Flapstack-owned deterministic script/controller inspired by Claude dynamic workflows                               | Default and recommended; supports mixed harness workers       |
| `codex-v2` | Codex task tree (V2)      | Native named task tree, mailboxes, follow-ups, selective context forks, and reusable interrupted/completed workers | Codex-capability gated                                        |
| `codex-v1` | Codex legacy threads (V1) | Native ID-based spawn/send/wait/resume/close compatibility                                                         | Advanced, non-default, and removable after migration evidence |

Settings resolve in this order: per-launch override, project override, global
default, then `workflow`. The resolved engine and engine-version snapshot become
immutable when an orchestration starts. Switching engines creates a new run or
fork; it never mutates the semantics of active or historical work. Unsupported
modes remain visible with a reason and cannot silently fall back.

### Default workflow engine

The workflow engine moves orchestration control flow out of the lead model and
into an inspectable, versioned script/graph. A restricted runtime may coordinate
agents, parallel/pipeline/map steps, typed variables, branches, loops, barriers,
timeouts, retries, and synthesis. It cannot read files, run shell commands, or
change permissions directly; workers perform those actions through normal
Flapstack runs.

Before launch, Flapstack shows the resolved phases, worker count/concurrency,
models/harnesses, worktrees, permissions, budgets, and estimated scale. Workflow
agent output can be schema-validated. A failed required dimension or verifier
fails closed. Checkpoints persist completed step results so restart or resume
does not rerun completed work unless the user explicitly requests a retry.

Human approval gates divide a workflow into separate resumable segments. The
runtime never pretends it can pause arbitrary JavaScript halfway through an
unmodeled side effect and safely ask a question.

### Codex engine adapters

The V2 adapter maps canonical task paths, `fork_turns`, send-message,
follow-up-task, interrupt, list, wait/mailbox updates, completion envelopes, and
resident/unloaded state into Flapstack agent and message records. Completed or
interrupted workers may unload from memory only after their rollout is durable;
pending mailbox work prevents unload.

The V1 adapter maps agent IDs/nicknames, send-input interrupt behavior, final
status waits, resume, and close. V1 exposes no fake V2 names or mailbox features.
Its UI is explicitly labeled legacy. Both adapters record provider action intent
before sending it, reconcile after restart, and never replay an uncertain spawn.

### Agent Runtime is a separate axis

Coordination engine answers how a group cooperates. Agent Runtime answers how
each worker communicates with its harness, resumes, emits activity, and renders.
`add-agent-runtimes` owns `codex`, `claude-code`, and `flapstack-native` runtime
selection, provider event fidelity, and per-chat controls. This feature stores
the resolved runtime on every worker definition/run and may combine different
runtimes inside one workflow. It never infers runtime from model vendor.

### Fleet, policy, and recovery

- Fleet and lineage views use the durable Stage 3 rows plus engine-specific
  projections. V2 task paths and workflow phases are labels/projections, not new
  authority roots.
- Policy changes use optimistic versioning. Tightening limits applies
  immediately; relaxing authority or budget uses the Stage 3 approval/audit gate.
- Stop records durable cancellation intent before signaling runs. Restart resumes
  cancellation reconciliation, never work execution.
- Orphans remain attached to the orchestration and display the missing parent;
  they are never silently reparented.
- Templates contain workflow/agent definitions, harness/model preferences,
  dependencies, limits, schema, and worktree strategy, but no credentials,
  session grants, live IDs, or inherited hidden authority.

### Multi-agent activity projection

`add-agent-runtimes` owns lossless provider events, privacy labels, persistence,
controls, and per-chat rendering. Multi-agent operations adds only group-level
events and projections: workflow phase/checkpoint, coordination message,
mailbox/follow-up, dependency/barrier, spawn/replacement, aggregated status,
warning, and usage. Every projection references the authoritative runtime event,
agent, run, and orchestration rather than copying provider text.

The operation workspace and fleet timeline can filter by agent, runtime,
workflow phase, task path, or event kind. Generated progress prose is labeled
`Activity summary`, never provider reasoning. Batching and virtualization come
from the runtime activity surface and remain bounded for large fleets.

### Operation workspace relationship

Starting an orchestration creates or binds one task-scoped operation workspace
owned by the saved-workspace capability. The initiating chat and every spawned
agent chat belong to its roster. The workspace references existing chats and
runs; it never duplicates them. Detailed layout and ownership behavior is
specified by `add-saved-workspaces`.

### Agent profiles and personalities are owned by S4-F12

The promoted S4-F12 agent-creation product keeps four independently versioned
layers:

1. capability profile: role, instructions, tools, skills, model/effort,
   permissions, memory policy, worktree strategy, and allowed descendants;
2. presentation style: tone, verbosity, formatting, and optional character voice;
3. workflow template: topology, phases, dependencies, schemas, and gates;
4. resolved runtime snapshot: immutable values used by one launched agent.

A personality or output style cannot grant tools, permissions, secrets, memory,
or a stronger model. S4-F12-T1 resolves profile scope/precedence, portability,
trust, evaluation, model compatibility, memory, catalog, and editing UX before
implementation. S4-F12 then owns workflow-bound profiles, standalone named
agents, starter types, Profile Studio, and acceptance. A hosted/community
marketplace remains out of scope unless separately promoted.

## Risks / Trade-offs

- Three modes increase testing and support cost. Keep `codex-v1` advanced and
  require capability probes; `workflow` is the stable product default.
- Provider runtimes can drift. F3 consumes the capability/version snapshot from
  S4-F11 and never guesses unsupported coordination semantics.
- Workflow scripts can fan out cost quickly. Require preview, concurrency/agent
  caps, budgets, large-run warnings, and stop/resume controls.
- Fleet controls can amplify mistakes. Require exact target counts, impact
  preview, bounded selection, and audit.
- Reasoning output can be sensitive or misleading. Render only provider-exposed
  content, preserve provenance, and never label generated progress summaries as
  hidden model reasoning.
- Existing Stage 3 live proof remains open. S4-F3-T1 blocks implementation until
  shipped behavior and remaining evidence are reconciled.

## Migration Plan

1. Add engine, version, runtime references, mailbox/checkpoint, and
   workspace-link fields/tables additively. Existing Stage 3 orchestrations read
   as `workflow-legacy-graph` for history and are never replayed.
2. Default new installations and users without a saved choice to `workflow`.
3. Keep existing current graph creation available through a compatibility
   importer while workflow templates are introduced.
4. Add Codex V2 behind capability detection, then V1 behind Advanced settings.
5. Consume S4-F11 activity rows for group projections; never backfill or copy
   provider reasoning in the orchestration migration.

Rollback disables the new engines and UI without deleting chats, runs, usage,
agent history, workflow scripts, or saved workspaces.

## Open Questions

- S4-F12-T1 must resolve profile naming, source precedence, trust/import model,
  evaluation gates, voice inheritance, sharing boundary, starter catalog, and
  whether profiles may request persistent memory before S4-F12 implementation.
- Whether a future provider-native Claude team adapter is valuable after the
  provider-neutral workflow engine ships. It is not required for this change.
