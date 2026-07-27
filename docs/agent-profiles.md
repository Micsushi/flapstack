# Agent Profiles and Personalities

Agent Profiles are local, versioned named-agent definitions. One profile contains two separate contracts:

- **Capability**: role, instructions, harness, Runtime preference, model preference, tools, skills, permissions, memory policy, worktree strategy, and descendant limits.
- **Personality and presentation**: tone, verbosity, formatting, response structure, character label, voice display label, and color.

Presentation never grants capability. Every workflow or standalone launch stores one immutable resolved profile snapshot alongside the normal Runtime snapshot.

## Safe defaults

- One exact base profile version; multiple inheritance and cycles are rejected.
- Launch override, workflow override, selected version, base version, and product defaults are inspectable per field.
- Task, project, and orchestration policy intersects capability after composition. It may narrow authority but never widen it.
- Persistent profile memory is `none`.
- Hosted/community marketplace, remote publishing, remote updates, and arbitrary executable profile code are disabled.
- Voice labels are display metadata. Audio voice remains owned by Voice settings.
- Runtime or model incompatibility blocks launch with a repair message. There is no silent fallback.
- New profiles and built-in starters default to the Claude Code harness and Runtime. Codex-backed
  profiles are previewed as unavailable and cannot be confirmed or launched because the current
  Codex Runtime cannot enforce an exact frozen allowlist for no-approval tools. Existing immutable
  Codex profile versions and snapshots remain historical records; they are not rewritten.
- Presentation-only edits and capability narrowing save normally. Capability widening is classified field-by-field and requires one exact Tier-3 approval that is revalidated and consumed inside the version write.

## Profile Studio

Open **Settings → Agent Profiles**. Profile Studio supports blank creation, an exact base version, versioned edits, duplicate, search, archive/restore, resolved field-source preview, local evaluation, local import/export, and standalone launch.

Built-in Planner, Implementer, Reviewer, and Verifier profiles are read-only. Duplicate a starter before editing it.

The local evaluation runner requires the complete unique schema, capability, permission, prompt-injection, determinism, and task-quality fixture set plus Runtime compatibility. A subset or duplicate set is rejected before evidence is written. Passing local fixtures records `tested-local`; it does not claim provider/model support. An untested or failed built-in combination is launch-blocked until its exact version and resolved Runtime/model pass; user-created profiles remain explicitly preview-and-confirm flows.

## Standalone launch

Use **Start named agent** from a task, a chat, or Profile Studio.

1. Choose one exact profile version.
2. Explicitly select task and visible parent-chat context.
3. Preview the resolved snapshot, Runtime, permission, and conflicts.
4. Confirm once.

Confirmation transactionally creates exactly one chat, sub-chat, run, profile snapshot link, audit event, and standalone launch record before dispatch through Agent Runtime. A canonical request fingerprint covers source, context flags, exact profile version, overrides, orchestration membership, and confirmed digest, so a reused request ID with different launch semantics fails. Follow-up and retry keep the original immutable profile and Runtime snapshots, but first compare that snapshot directly with every current durable permission, tool, skill, model, Runtime, and descendant ceiling. Narrowing blocks and requires a new confirmation; source-profile rename, edit, or archival alone does not. Continue with an updated profile requires a new profile version and creates a new chat/run boundary.

Parent-chat context contains visible stored messages only. Provider-private state, credentials, sessions, and hidden reasoning are excluded. The renderer supplies preferences and context selection only. Main derives the complete launch ceiling from current project, task, chat, Runtime-default, and orchestration rows; the public standalone schema rejects renderer-supplied authority.

## Workflow binding

The Agent Profile workflow adapter binds an exact profile version to an existing F3 workflow run and step. Profile Studio accepts the existing run and step IDs and can export or import a versioned template reference; it does not edit the graph. A separate confirmation action derives the launch-policy ceiling from durable task, Runtime-default, and orchestration rows, narrows the profile, rejects blocking conflicts, and CAS-freezes one immutable snapshot. A bound but unconfirmed step cannot launch. Checkpoint resume and retry reuse the confirmed snapshot, including its frozen display name; later rename, edit, or archival cannot change the materialized F3 definition. Editing a confirmed binding is rejected. Fork a new workflow run to use an updated profile.

Workflow template export contains only the exact profile reference, role, schemas, and bounded overrides. It never contains a resolved snapshot, permission policy, credentials, or authority grant. Imported and forked bindings are unconfirmed until the destination workflow is confirmed against its own durable policy.

Profile instructions cannot change workflow topology, dependencies, budgets, gates, or permissions. F3 remains the scheduling authority. F11 remains the Runtime selection and dispatch authority.

### F3 integration

F12 exports `AgentProfileWorkflowMaterializerPort` and `createAgentProfileWorkflowMaterializerPort`. The exact hook is:

```ts
materialize(request: {
  workflowRunId: string
  taskId: string
  stepId: string
  attemptCount: number
  agentDefinition: OrchestrationAgentDefinition
}): Promise<
  | {
      kind: "unbound"
      agentDefinition: OrchestrationAgentDefinition
      profileSnapshotId: null
      bindingVersion: null
    }
  | {
      kind: "bound"
      agentDefinition: OrchestrationAgentDefinition
      profileSnapshotId: string
      bindingVersion: number
    }
>
```

`attemptCount` is the same positive checkpoint-attempt identity F3 passes to F11 ownership: `priorAttempts + 1`.

Production initialization registers the lazy profile materializer with the F3
operations runtime. `WorkflowEngine` calls it after checkpoint eligibility,
dependency, concurrency, budget, retry, permission, and worktree checks, then
persists the returned `agentDefinition` and snapshot provenance before creating
worker rows or calling the F11 reserve/launch seam. The same materialized
definition is used for durable ownership and launch, so F11's definition
equality check remains fail closed.

Fail-closed behavior is exact: no binding returns the original embedded definition; a bound but unconfirmed binding throws `binding-unconfirmed`; missing/invalid durable policy, profile, evaluation, runtime, model, or authority resolution blocks confirmation; task/run/step/definition identity mismatch throws `f3-contract-conflict`; no case falls back from a broken bound profile to the embedded definition. Before every attempt, F12 compares the frozen snapshot capability directly with the current permission, model, Runtime, tool, skill, and descendant ceiling. A narrowed current ceiling blocks and requires fork/reconfirmation. This check never re-reads or re-resolves the source profile, so later profile edits or archival do not invalidate a safe confirmed snapshot. F12 preserves F3 `agentId`, `definitionId`, and dependency identity. F3 must create no worker rows when the hook throws and must leave the checkpoint blocked with repair text.

F3 headless acceptance must prove: the hook runs before any durable worker
insert; returned definition and snapshot provenance are persisted; F11 reserve
accepts exact durable/request definition equality; unbound steps pass through;
unconfirmed or invalid bindings create zero worker rows; retry/resume reuse one
snapshot and one checkpoint attempt identity; a crash after confirmation but
before worker creation resumes without a second snapshot or duplicate worker;
fork plus a new profile confirms a new snapshot. This is implemented production
integration and remains subject to the normal Tier 2 core evidence gate, not a
missing-code or owner-manual dependency.

## Import and export trust

Exports are schema-versioned, secret-scanned JSON bundles. Import is two-phase: parse/validate/preview, then digest-confirmed persistence. Imported instructions are untrusted data. Import removes tools and skills, narrows permission to read-only, disables descendants, keeps memory off, drops base inheritance, and records exact unresolved reasons plus untrusted provenance. Resolved preview keeps those disabled reasons visible. Referenced extensions are not enabled.

## Diagnostics and recovery

Profile Studio diagnostics show profile/version, snapshot/launch, and local/supported evidence counts plus disabled feature boundaries. The router also exposes pending import previews and failed evaluation evidence.

On restart, standalone launch state is projected from the authoritative durable F11 run state. Pending stays pending, running stays running, and completed, cancelled, or failed are never invented from a cancel return value or thrown dispatch error. Unknown durable state becomes `uncertain`; it is never replayed automatically. Immutable snapshot, version, and evaluation triggers prevent historical mutation.

## Separate capability, release, and owner evidence

The following do not all share one completion class:

- Automated semantic structure, accessible-name/state, focus-order, and
  keyboard-operation checks can satisfy the Profile Studio Tier 2 accessibility
  contract. The owner's keyboard, screen-reader, and visual walkthrough remains
  Tier 3 in `owner-manual-testing-backlog.md`.
- Credentialed Claude Code workflow/standalone launches are provider-capability
  evidence. Codex profile capability certification remains open until exact
  upstream tool enforcement exists.
- Forced live-app restart and multi-window profile behavior remains
  `T2-core`.
- Packaged macOS preview is a release gate.
- Windows/Linux and device-specific evidence is capability or release evidence
  as labeled in the owning matrix.

Use only `npm run dev`, then prove the running checkout with `npm run dev:verify`. Never test against a production Flapstack app.
