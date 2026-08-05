# S4-F12 — Agent Profiles and Personalities

Implementation status: `T2-core` complete. All eight core tasks are accepted.
Optional provider, accessibility, and package certification remains separate in
the Stage 4 matrix. Dated partial evidence below is historical.

### S4-F12-T1 — Resolve the agent-profile product contract

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: The unpolished agent-personality idea becomes a reviewed product contract with no hidden implementation guesses.
- Scope: Compare pinned OMO/ECC agent, category, routing, workflow, schema, and catalog patterns with F3/F11; decide vocabulary, starter types, scope/inheritance/precedence, workflow and standalone UX, trust/import/sharing, memory, model/runtime compatibility, evaluation, voice ownership, and community-marketplace boundary; record recommended defaults and rejected alternatives.
- Out of scope: Schema, UI, profile creation, importing third-party profiles, or implementation.
- Acceptance: Every named decision has one selected behavior, rationale, migration/safety consequence, and owner task; personality/capability separation is non-negotiable; hosted marketplace and unresolved persistent memory remain disabled unless explicitly promoted.
- Verification: Design review against the pinned OMO/ECC snapshots, F3/F11 contracts, threat-model checklist, UX flow review, and strict OpenSpec validation.
- Blocked by: S4-F3-T6 and S4-F11-T1
- Blocks: S4-F12-T2, S4-F12-T3, S4-F12-T4, S4-F12-T7
- Context: `design.md`, S4-F3 coordination/workflow design, S4-F11 runtime design, OMO `team-core`/agent/category schemas, ECC agents/skills/workflows and `orch-review.workflow.js`.

### S4-F12-T2 — Add profile, personality, and snapshot contracts

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Capability, personality, workflow binding, and runtime resolution have one typed, versioned, safe composition contract.
- Scope: IDs/versions/scopes, one-base inheritance, capability and presentation schemas, runtime/model/skill/tool/memory/worktree/descendant references, workflow bindings, field-source provenance, precedence resolver, capability intersection, immutable resolved snapshots, migrations, DTOs, and legacy interpretation.
- Out of scope: CRUD UI, provider launch, workflow execution, import/export, or built-in prompts.
- Acceptance: Cycles/multiple inheritance fail; every resolved field names its source; personality cannot change capability; authority only narrows without approval; every launch snapshot is immutable and complete; old chats/runs remain unchanged.
- Verification: Migration fixtures, schema/property tests, precedence table, cycle/conflict tests, permission-intersection tests, snapshot immutability, serialization, typecheck, and lint.
- Blocked by: S4-F12-T1, S4-F3-T6, S4-F11-T2
- Blocks: S4-F12-T3, S4-F12-T4, S4-F12-T5, S4-F12-T6, S4-F12-T7
- Context: orchestration agent definitions, workflow templates, Agent Runtime resolver/snapshot, permissions, skills/extensions, memory/vault policy, worktree strategy.

### S4-F12-T3 — Add local profile lifecycle, trust, and portability

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Users safely manage reusable profiles and exchange them without secrets or inherited authority.
- Scope: Versioned local CRUD/service/router, duplicate/archive/restore/search, optimistic updates, built-in versus user/project scope, provenance, schema compatibility, secret scanning, import parse/validate/preview, disabled unresolved references, versioned export bundle, conflict handling, audit, and restart recovery.
- Out of scope: Hosted marketplace, automatic remote updates, arbitrary executable profile code, or enabling referenced extensions.
- Acceptance: Profiles contain no credentials/session grants; imports perform no authority mutation before confirmation; missing tools/skills/hooks/MCP/memory/runtime remain disabled; built-ins are read-only; user copies and historical versions never change silently.
- Verification: CRUD/version conflicts, crash transaction, archive/restore, redaction/secret fixtures, malicious import, schema upgrade/downgrade, unresolved dependency, export/reimport, audit, and restart tests.
- Blocked by: S4-F12-T1, S4-F12-T2, S4-F1-T3, S4-F8-T2
- Blocks: S4-F12-T4, S4-F12-T5, S4-F12-T6, S4-F12-T7, S4-F12-T8
- Context: Stage 4 extension registry/trust, portability bundle registry, saved definitions, redacted audit, settings persistence.

### S4-F12-T4 — Build Profile Studio and resolved preview

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Users create and understand named agents without editing raw provider files or confusing personality with permission.
- Scope: Profile list/search/filter, create blank/duplicate/compose, identity/type/description, capability editor, personality/style editor, base selection, model/runtime/skill/tool/memory/worktree/descendant controls, instruction editor, field-source diff, compatibility/evaluation state, resolved launch preview, test-without-authority-increase flow, accessibility, and multi-window invalidation.
- Out of scope: Workflow graph editing, launching without confirmation, prompt marketplace browsing, or exposing hidden provider prompts/reasoning.
- Acceptance: Capability and personality are semantically and visually
  separate; every inherited/overridden field is inspectable; invalid
  combinations cannot save or launch; changes are versioned; automated
  accessibility checks cover accessible names/states, focus order,
  keyboard-operable controls, errors, and the create, preview, duplicate, and
  archive flows. The owner's keyboard/screen-reader walkthrough remains Tier 3.
- Verification: Reducer/form validation, component/accessibility, settings
  search, inheritance/source display, compatibility states, optimistic conflict,
  multi-window, agent-operated visual/live Profile Studio walkthrough, and
  restart tests.
- Blocked by: S4-F12-T1, S4-F12-T2, S4-F12-T3
- Blocks: S4-F12-T5, S4-F12-T6, S4-F12-T7, S4-F12-T8
- Context: Settings shell/search, Stage 3 Custom Agents provider inventory distinction, model/runtime selectors, permission and memory controls, root `ui-design.md`.

### S4-F12-T5 — Bind named profiles to deterministic workflows

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Workflow authors can assign reusable named specialists and personalities to steps with reproducible execution.
- Scope: Exact profile-version references, workflow role, typed step inputs/output schema, bounded overrides, compatibility and authority preview, mixed-profile/runtime workers, snapshot persistence, checkpoint/resume, retry/fork-with-updated-profile, missing/archived profile repair, activity/lineage labels, and template import/export references.
- Out of scope: Letting profile prompts control workflow topology, bypassing workflow limits, or mutating a running step's snapshot.
- Acceptance: Every launched step records one resolved snapshot; resume reuses it; edits affect future launches only; missing/incompatible profiles block with repair choices; profile instructions cannot change workflow dependencies, budgets, gates, or permissions.
- Verification: Workflow schema, multi-profile parallel/pipeline, override precedence, mixed runtime, checkpoint/resume, retry/fork, missing/archive, budget/permission, activity/lineage, restart, and import/export tests.
- Blocked by: S4-F12-T2, S4-F12-T3, S4-F12-T4, S4-F3-T4, S4-F3-T7, S4-F11-T9
- Blocks: S4-F12-T7, S4-F12-T8
- Context: deterministic workflow runtime/checkpoints, orchestration templates, Agent Runtime selection, operation workspace roster, activity envelope.

### S4-F12-T6 — Launch standalone named agents

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Users can spin out a named specialist/personality outside a predefined workflow and continue working with it safely.
- Scope: Start-agent actions from task/chat/Profile Studio, profile chooser and resolved preview, durable chat/run/profile snapshot, optional orchestration/workspace membership, task and parent-chat context selection, runtime/harness launch, follow-up turns, stop/retry, Continue-with-updated-profile boundary, display identity, provenance, usage/audit, and restart recovery.
- Out of scope: Background autonomous scheduling, implicit cross-project access, mutable active snapshots, or identity based only on display name/color.
- Acceptance: Confirmation creates exactly one chat/run; selected context and authority are explicit; standalone agents use the same profile contract as workflow agents; follow-ups retain the snapshot; updated-profile continuation creates a clear new run/session boundary; restart never duplicates launch.
- Verification: Task/chat/studio launch, context boundaries, exact-one creation race, permission/runtime failures, workspace/lineage, follow-up, cancel/retry, updated-profile continuation, usage/audit, multi-window, and restart tests plus live Codex/Claude walkthroughs.
- Blocked by: S4-F12-T2, S4-F12-T3, S4-F12-T4, S4-F11-T8, S4-F4-T6
- Blocks: S4-F12-T7, S4-F12-T8
- Context: Stage 3 agent/chat/run materialization, Agent Runtime launch, task/chat context, saved operation workspaces, lineage/activity UI.

### S4-F12-T7 — Add starter types and profile evaluation

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Flapstack ships a small trustworthy starter set and honest compatibility evidence instead of a sprawling prompt catalog.
- Scope: Implement only T1-approved starter roles, read-only versioning, user-copy flow, behavior/capability/safety/prompt-injection fixtures, task-quality scorecard, cross-model/runtime compatibility runs, untested/tested labels, regression thresholds, update notes, and profile test runner/history.
- Out of scope: Universal quality claims, automatic model routing solely from personality, leaderboard marketing, or importing the full OMO/ECC catalog.
- Acceptance: Every built-in has purpose, bounded capability, supported combinations, evidence, and owner; failed safety/capability gates block promotion; untested combinations are labeled honestly; copying a starter creates an independent user version.
- Verification: Schema and golden fixtures, prompt-injection/adversarial suite,
  permission invariants, supported runtime/model matrix, scorecard
  reproducibility, update regression, copy/version tests, and agent-operated live
  catalog discovery walkthrough.
- Blocked by: S4-F12-T1, S4-F12-T2, S4-F12-T3, S4-F12-T4, S4-F12-T5, S4-F12-T6
- Blocks: S4-F12-T8
- Context: OMO category/model-fit research, ECC role/workflow separation, provider/runtime capability fixtures, evaluation harness, Profile Studio.

### S4-F12-T8 — Close agent-profile and personality acceptance

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F12
- Outcome: Custom, workflow-bound, standalone, imported, and starter agents work reproducibly with safe authority and truthful compatibility.
- Scope: Matrix S4-AP01 through S4-AP08, full automated gate, migration, custom profile lifecycle, personality/capability separation, workflow and standalone launches, runtime compatibility, import/export trust, starter evaluations, restart, automated semantic/accessibility checks, and docs.
- Out of scope: Hosted/community marketplace, autonomous remote profile updates, or private chain-of-thought display.
- Acceptance: A user creates one named profile/personality, uses it in a deterministic workflow, spins it out standalone, resumes both after restart, exports/reimports it without secrets, and observes matching snapshot, runtime, permission, workspace, lineage, activity, usage, and audit state; every profile-related authority increase remains approval-gated.
- Verification: Node 22 `npm run check`, strict OpenSpec, profile/evaluation
  suites, migration fixtures, automated semantic/accessibility checks,
  `npm run dev:verify`, production-path workflow and standalone exercises, and
  forced restart. Credentialed provider and packaged-preview certifications
  remain in their separately labeled matrix rows; Codex profile capability
  certification stays open until exact upstream tool enforcement exists.
- Blocked by: S4-F12-T3, S4-F12-T4, S4-F12-T5, S4-F12-T6, S4-F12-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`, S4-F3/F4/F11 acceptance,
  profile diagnostics, and Tier 2 acceptance guidance.
