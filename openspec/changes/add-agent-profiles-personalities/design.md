## Context

S4-F3 introduces deterministic workflows and Codex coordination modes. S4-F11
introduces per-agent runtime selection and high-fidelity activity. This feature
adds reusable agent identity above those layers; it does not create another
scheduler or transport.

Research inputs:

- Oh My OpenAgent `bb0f6fbb69ca`: useful category/model routing, team-core,
  mailbox, worktree, allowed-subagent, and harness-adapter boundaries; avoid its
  prompt/hook sprawl, rigid model-persona coupling, and fragmented file state.
- Everything Claude Code `ed387446052d`: useful separation of agents, skills,
  rules, hooks, and executable workflows plus schema-checked review barriers;
  avoid an oversized duplicate catalog with weak discovery and drift control.
- Codex and Claude behavior research from S4-F3/S4-F11: runtime, reasoning,
  coordination, and presentation are independent product axes.

## Goals / Non-Goals

- Goals: user-authored named agents, reusable capability profiles and
  personalities, workflow-step binding, standalone launch, immutable snapshots,
  safe composition, local import/export, evaluated starter types, and honest
  compatibility previews.
- Non-goals: hosted marketplace, autonomous profile downloads, personality-based
  permission escalation, secrets in profiles, hidden chain-of-thought prompts,
  copying OMO/ECC catalogs, or making every prompt fragment a separate product.

## Decisions

### Four separate layers

One launch resolves four independently versioned layers:

1. `capabilityProfile`: role, instructions, tools, skills, model/effort
   preference, permission ceiling, memory policy, worktree strategy, allowed
   descendants, and runtime preference;
2. `presentationStyle`: tone, verbosity, formatting, response structure, and
   optional character/voice identity;
3. `workflowBinding`: selected profile version, workflow role, step-specific
   inputs/outputs, dependencies, schemas, and bounded overrides;
4. `resolvedAgentSnapshot`: immutable fully resolved values used by one agent
   launch, including source versions and compatibility decisions.

The simple UI may present capability and personality together as one Agent
Profile. Persistence and resolution keep them separate so changing tone cannot
grant tools, permissions, memory, descendants, secrets, or a stronger model.

### Research and promotion gate

S4-F12-T1 is a blocking research/decision task, not an implementation task. It
must compare the pinned OMO/ECC patterns with Flapstack's actual Stage 4
contracts and lock:

- vocabulary and editor mental model;
- built-in starter types and minimum useful catalog;
- definition scopes, inheritance, override precedence, and conflict UX;
- import trust, signing/provenance, update, sharing, and duplication behavior;
- memory ownership/retention and whether any profile may request persistent memory;
- model/runtime compatibility and fallback rules;
- evaluation gates for built-in and imported profiles;
- whether community publishing remains out of scope.

Recommended defaults are a small local-only catalog, no hosted marketplace,
explicit import preview, no secrets, no implicit persistent memory, and no
silent runtime/model fallback. Later tasks cannot start until the decision
record is complete.

### Identity, scope, inheritance, and precedence

Profiles have stable IDs, human names, descriptions, category/type, immutable
versions, source/provenance, scope, and archive state. A profile may extend one
base profile. Cycles and multiple inheritance are rejected.

Recommended resolution order is launch override, workflow-step override, task
or project override, selected profile version, optional base profile, then
built-in defaults. Every field records its source in the preview. Capability is
always intersected with task/project/orchestration policy and the current
approval grant; precedence can narrow authority but never widen it.

### Custom and starter agents

Users can create profiles from blank, duplicate a starter, or compose a
capability profile with a presentation style. Starter types are examples, not
privileged hidden prompts. Exact names are decided by T1; candidate roles may
include planning, research, implementation, debugging, review, verification,
and coordination.

Built-ins are read-only and versioned. User copies become independent. Updating
a built-in never mutates historical snapshots or silently rewrites a user copy.

### Workflow agents

Each deterministic workflow step may reference an exact profile version and
provide bounded inputs, output schema, and safe overrides. The launch preview
shows resolved name, role, runtime/harness/model, tools, skills, permissions,
memory, worktree, descendants, personality, budget, and source of every override.

Workflow checkpoints store the resolved snapshot ID. Resume reuses it. Editing
or deleting the source profile affects future launches only. Mixed profiles and
runtimes are allowed when compatibility probes pass.

### Standalone named agents

From a task, chat, or Profile Studio, the user may choose `Start agent`, select
a profile, inspect the resolved preview, and launch. Flapstack creates normal
durable chat/run records and, when part of an orchestration, adds the agent to
that operation workspace and lineage.

Follow-up turns keep the same agent/profile snapshot unless the user chooses
`Continue with updated profile`, which creates a new run/session boundary with
explicit visible-history context. A display name, color, or character identity
never replaces durable run/chat/profile IDs.

### Storage, import, and trust

Profiles are typed local records, not arbitrary executable scripts. Export uses
a versioned secret-free bundle. Import is parse/validate/preview first, shows
provenance and requested capabilities, disables unresolved skills/tools, and
never enables hooks, MCP, network, memory, or permissions automatically.

Untrusted imported instructions remain visible and editable. Workflow code,
hooks, or skills referenced by a profile follow their own Stage 4 approval and
trust systems; the profile cannot smuggle their content or authority.

### Memory and privacy

Default profiles have no private persistent memory. A memory policy names an
existing allowed store/scope and retention rule; it never embeds conversation
history or credentials in the profile. Launch preview states what memory can be
read or written. Personality instructions are visible product data, not hidden
reasoning, and exports respect private/local-only fields.

### Evaluation and compatibility

Built-in profiles require schema, safety, capability, prompt-injection,
cross-model/runtime, determinism-boundary, and task-quality fixtures. Imported
or edited profiles show `Untested`, `Tested locally`, or compatible versioned
evidence without implying universal model quality.

Model/personality fit may be a recommendation, never a hardcoded hidden routing
rule. Incompatible runtime/model/tool requirements block launch with an exact
reason; they do not silently substitute another profile or expand authority.

## Risks / Trade-offs

- A large catalog becomes hard to trust and discover. Start small, searchable,
  typed, versioned, and duplicable; require evidence before adding built-ins.
- Prompt inheritance can become invisible magic. Allow one base only and show a
  fully resolved field/source diff before launch.
- Personality can disguise capability changes. Render capability and style in
  separate sections and require approval only for capability increases.
- Profile edits can break reproducibility. Snapshot every launch and never
  mutate historical snapshots.
- Cross-model behavior varies. Record compatibility evidence and use honest
  recommendations instead of promising identical behavior.
- Imported prompts can contain hostile instructions. Preview all instructions,
  strip secrets/authority, and keep referenced extensions disabled until their
  own approval path succeeds.

## Migration Plan

1. Complete T1 and record decisions before schema/UI implementation.
2. Add profile/style/version/snapshot records additively; create no profiles
   from historical chats automatically.
3. Ship read-only starter profiles and local CRUD before workflow binding.
4. Add workflow binding and standalone launch behind capability checks.
5. Add import/export only after trust preview and redaction tests pass.
6. Promote starter types individually after evaluation evidence.

Rollback disables profile selection and new launches while preserving profile
definitions, snapshots, chats, runs, workflows, and history. Existing agents
continue using their immutable snapshots.

## Open Questions

S4-F12-T1 must resolve the exact starter catalog, scope/precedence UI, memory
policy, import provenance/signing, sharing boundary, evaluation scorecard, and
whether character voice belongs in Profile Studio or the separate Voice system.
