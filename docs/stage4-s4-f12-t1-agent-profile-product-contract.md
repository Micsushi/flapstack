# S4-F12-T1 Agent Profile product contract

Research snapshots:

- Oh My OpenAgent `bb0f6fbb69ca8361b95f7d564d164c25b1396bc9`
- Everything Claude Code `ed387446052dfbc6b52de149406b70efa65edc59`
- Flapstack S4-F3 coordination contract through migration `0035`
- Flapstack S4-F11 Agent Runtime contract through migrations `0032` and `0033`

The pinned OMO checkout contributes harness-neutral team, mailbox, task-list,
worktree, category, agent, and allowed-descendant boundaries. Its fragmented
file state, category-to-model fallback, prompt injection, and hook-heavy catalog
are rejected. The pinned ECC checkout contributes separate agent, skill, rule,
hook, and executable-workflow concepts plus schema-checked, fail-closed review
barriers. Its 67 top-level agent definitions and duplicated specialist catalog
are rejected. No source is copied from either project.

## Locked decisions

| Decision            | Selected behavior                                                                                                                                                                                                                                              | Rationale                                                                                                                                                           | Migration and safety consequence                                                                                         | Owner    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Vocabulary          | The product is an **Agent Profile** composed from a **Capability Profile** and **Presentation Style**. A launch produces a **Resolved Agent Snapshot**. A workflow stores a **Profile Binding**.                                                               | Matches F3/F11 without overloading Runtime, engine, mode, or provider profile.                                                                                      | Existing chats/runs gain no inferred profile. New launch rows name exact source versions.                                | T2       |
| Editor mental model | Profile Studio has visibly separate Capability and Personality sections, followed by a resolved source/compatibility preview.                                                                                                                                  | One friendly object in UI; separate authority domains in storage.                                                                                                   | Personality edits can never touch capability columns or approval state.                                                  | T4       |
| Starter catalog     | Ship four read-only starters: Planner, Implementer, Reviewer, and Verifier.                                                                                                                                                                                    | Covers the smallest recurring workflow roles without ECC-style catalog sprawl. Research remains a user-created specialization because network/source policy varies. | Each starter is versioned and individually promotion-gated. User edits always duplicate.                                 | T7       |
| Scope               | Built-in, user, or project. Project profiles require an existing active project.                                                                                                                                                                               | Local-first ownership is explicit and searchable.                                                                                                                   | No organization/cloud scope or hosted account dependency.                                                                | T2/T3    |
| Inheritance         | Zero or one exact base profile version. Multiple inheritance and cycles fail.                                                                                                                                                                                  | Keeps composition inspectable and deterministic.                                                                                                                    | Base edits do not move a child; selecting a newer base creates a new child version.                                      | T2       |
| Precedence          | Launch override, workflow-step override, task/project policy, selected version, base version, built-in defaults.                                                                                                                                               | Mirrors F3/F11 launch resolution while keeping source provenance.                                                                                                   | Every resolved field records a source. Capability is intersected after precedence.                                       | T2       |
| Conflict UX         | Invalid schema/base cycles cannot save. Unavailable dependencies can save/import only as disabled requirements. Authority/runtime conflicts block launch with repair text.                                                                                     | Definitions remain recoverable without unsafe launch.                                                                                                               | No silent fallback, substitution, or implicit approval.                                                                  | T3/T4    |
| Workflow UX         | A deterministic step binds an exact profile version and bounded input/output, presentation, model-effort, and instruction overrides. Topology, dependencies, gates, budgets, permissions, Runtime compatibility, and engine are not profile-controlled.        | F3 stays scheduler-authoritative.                                                                                                                                   | Resume reuses the checkpoint snapshot; retry with updated profile is an explicit fork boundary.                          | T5       |
| Standalone UX       | Start Agent from task, chat, or Profile Studio opens the same resolved preview and explicit context selection. Confirmation owns one idempotency key and creates one chat/run/snapshot.                                                                        | Reuses normal Flapstack ownership instead of another agent system.                                                                                                  | Follow-ups reuse the snapshot. Continue with updated profile creates a new durable run boundary.                         | T6       |
| Import trust        | Parse, validate, secret-scan, and preview before confirmation. Imported definitions start untrusted. Missing skills, tools, hooks, MCP, memory, Runtime, or models are disabled with exact reasons.                                                            | Prompt text is untrusted data; references are not executable authority.                                                                                             | Import cannot enable extensions, permissions, network, memory, hooks, MCP, or secrets.                                   | T3       |
| Provenance/signing  | Record bundle digest, source label, imported-at time, and optional declared author. No signature implies unverified provenance; Stage 4 does not establish a signing PKI.                                                                                      | Honest local provenance without fake trust guarantees.                                                                                                              | Re-import conflicts require duplicate or explicit new-version choice. No automatic updates.                              | T3       |
| Sharing             | Versioned secret-free local export bundle only.                                                                                                                                                                                                                | Meets portability need without hosted service.                                                                                                                      | Hosted/community marketplace, publishing, discovery, and remote update stay disabled.                                    | T3       |
| Memory              | `none` is the only launchable Stage 4 memory policy. Imported or authored persistent-memory requests remain disabled/unresolved.                                                                                                                               | F12 has no accepted durable memory ownership/retention contract.                                                                                                    | Profiles cannot embed history, credentials, or grant store access. Persistent memory remains disabled.                   | T2/T3    |
| Runtime/model       | Profile values are preferences/ceilings. F11 selects and probes the Runtime; task/project policy intersects model/authority. Incompatibility blocks.                                                                                                           | Runtime is a separate axis owned by F11.                                                                                                                            | No model or Runtime fallback. Personality never affects routing.                                                         | T2/T5/T6 |
| Capability edits    | Presentation-only edits and monotonic capability narrowing save without approval. Permission, tool, skill, model/Runtime, worktree, or descendant widening requires one exact existing Tier-3 approval with stale revalidation and one-time audit consumption. | Capability and personality stay separate while legitimate reductions remain low-friction.                                                                           | Renderer cannot self-assert approval or authority; create/update reclassify inside the durable write.                    | T3/T4    |
| Evaluation state    | `untested`, `tested-local`, `supported`, or `failed`, tied to profile version, Runtime/model key, fixture set, and evidence digest.                                                                                                                            | Avoids universal cross-model claims.                                                                                                                                | Unknown combinations are labeled and default-blocked for built-ins; user profiles require explicit preview confirmation. | T7       |
| Evaluation gates    | Schema, capability invariants, permission narrowing, prompt-injection resistance, deterministic-boundary checks, task-quality fixtures, and supported Runtime/model compatibility. Any safety/capability failure blocks starter promotion.                     | Adopts ECC fail-closed barriers without prompt-defined orchestration.                                                                                               | Evidence is append-only; regressions never overwrite earlier evidence.                                                   | T7       |
| Voice               | Profile Studio may store a display voice/character label only. Audio voice selection and synthesis stay in the Voice system.                                                                                                                                   | Prevents presentation identity from taking over device/provider voice settings.                                                                                     | Character/voice metadata grants no audio, tool, model, or permission capability.                                         | T2/T4    |
| Community boundary  | No hosted marketplace, community publishing, remote catalog, automatic downloads, or remote updates in Stage 4.                                                                                                                                                | Trust, moderation, signing, and service ownership are unresolved and out of scope.                                                                                  | All related UI/actions remain absent or explicitly disabled.                                                             | T3/T8    |

## Capability boundary

Capability fields are role/instructions, harness, Runtime/model/effort preference,
tools, skills, permission ceiling, worktree strategy, allowed descendants, and
memory policy. Presentation fields are tone, verbosity, formatting, response
structure, color, and optional character/voice label. Presentation is never read
by capability intersection. A launch is allowed only when the requested
capability is a subset of current task/project/orchestration policy and F11 says
the exact harness/Runtime/model selection is compatible.

## Threat-model checklist

- Profile and bundle schemas are strict, size-bounded, and versioned.
- Instructions are visible text, never hidden reasoning or executable code.
- Credentials, tokens, private keys, session grants, environment assignments,
  and embedded conversation history are rejected or redacted.
- Imported references start disabled and do not mutate extension enablement.
- Project scope validates the durable project record; profile paths are not
  filesystem authority.
- One-base inheritance rejects missing bases, cycles, and scope violations.
- Optimistic versions prevent lost updates; historical versions and snapshots
  are append-only.
- Idempotency keys prevent duplicate standalone launch records.
- Runtime/model incompatibility blocks with a typed reason; no fallback exists.
- Capability intersection is monotonic narrowing; personality is excluded.
- Persistent memory, hosted marketplace, signing trust, remote update, arbitrary
  hooks, MCP enablement, and executable workflow content remain disabled.

## UX flows reviewed

Create: Profiles -> New -> identity -> Capability -> Personality -> source and
compatibility preview -> Save version. Duplicate: choose built-in/user profile ->
Duplicate -> independent user ID/version. Workflow: choose exact profile version
on a worker step -> inspect bounded overrides -> preview -> launch and persist
snapshot ID on checkpoint. Standalone: Start Agent -> choose profile and context
-> inspect capability/personality separately -> confirm once. Import: choose
bundle -> parse/secret scan -> inspect provenance and disabled requirements ->
confirm duplicate/new version. Archive: archive future selection only; active and
historical snapshots remain intact.

## Rejected alternatives

- Personality-coupled model routing: rejected because style cannot widen or
  redirect authority.
- OMO-style silent category/model fallbacks: rejected because F11 compatibility
  must fail closed.
- ECC-sized built-in catalog: rejected because discovery, duplication, and
  evaluation drift outgrow ownership.
- Multiple inheritance or free-form prompt fragments: rejected because source
  precedence becomes invisible.
- Embedded persistent memory/history: rejected until a separate retention,
  privacy, deletion, and authority contract is accepted.
- Signed/hosted marketplace claims: rejected because Stage 4 has no trust root,
  moderation owner, or hosted service.
