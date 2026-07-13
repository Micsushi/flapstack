# Agent Context and Evidence Quality Tasks

## AQ-F1 - Session and transcript correctness

### AQ-F1-T1 - Isolate Claude sessions by chat

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F1
- Outcome: New Claude chats never continue an unrelated latest session.
- Scope: First-message options, stored-session resume, missing-session recovery,
  and focused tests.
- Out of scope: Codex transport migration.
- Acceptance: Fresh chats use no continue/resume flag; existing chats resume only
  their stored ID; missing sessions restart fresh.
- Verification: focused Claude router/session tests.
- Blocked by: approved proposal
- Blocks: AQ-F2-T2, AQ-F5-T1
- Context: `src/main/lib/trpc/routers/claude.ts`.

### AQ-F1-T2 - Canonicalize Cursor text and tools

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F1
- Outcome: Cursor stores one answer and auditable tool events.
- Scope: Current stream shapes, cumulative/final text, nested tool payloads,
  fixtures, and persistence-facing parts.
- Out of scope: Cursor model selection.
- Acceptance: Exact repeated answers render once; known tools retain real
  name/input/output/result.
- Verification: `npm test -- --run tests/cursor-harness.test.ts`.
- Blocked by: approved proposal
- Blocks: AQ-F5-T1
- Context: `src/main/lib/cursor/stream.ts`, Cursor fixtures.

## AQ-F2 - Compact context and live scope

### AQ-F2-T1 - Build structured bounded context

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F2
- Outcome: Harness context has explicit sections, source metadata, and budgets.
- Scope: Context selection, truncation, fingerprinting, compact mode, and tests.
- Out of scope: Embeddings or cloud memory.
- Acceptance: Fresh and resumed context are deterministic and bounded; no model
  receipt instruction remains.
- Verification: `npm test -- --run tests/launch-context.test.ts`.
- Blocked by: approved proposal
- Blocks: AQ-F2-T2, AQ-F3-T1, AQ-F4-T1
- Context: `src/main/lib/harness/launch-context.ts`.

### AQ-F2-T2 - Adopt session-aware context in every router

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F2
- Outcome: Codex, Claude, Cursor, OpenRouter, and NanoGPT choose fresh or compact
  context from their actual session state.
- Scope: Router inputs, fallback-to-new behavior, and metadata.
- Out of scope: Codex App Server migration.
- Acceptance: Unchanged resumed turns do not resend all startup files; fresh
  fallback still receives required context.
- Verification: focused router tests and TypeScript.
- Blocked by: AQ-F1-T1, AQ-F2-T1
- Blocks: AQ-F3-T2, AQ-F5-T1
- Context: all five harness routers.

### AQ-F2-T3 - Remove duplicate Claude instruction channels

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F2
- Outcome: Claude receives each startup instruction through one deliberate path.
- Scope: Claude preset, setting sources, AGENTS append, and context metadata.
- Out of scope: Changing user-authored instruction files.
- Acceptance: Provider-native settings remain enabled without duplicating the
  same AGENTS content in system and user context.
- Verification: focused Claude option tests.
- Blocked by: AQ-F2-T1
- Blocks: AQ-F5-T1
- Context: Claude router query options.

## AQ-F3 - Evidence-first repository scope

### AQ-F3-T1 - Add read-only Git/worktree snapshot

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F3
- Outcome: Sensitive repository questions receive current branch, commit, dirty
  state, and worktree topology.
- Scope: Deterministic request classifier, bounded Git commands, redaction, and
  tests.
- Out of scope: Git mutation.
- Acceptance: Multi-worktree fixtures enumerate every branch/path/SHA and state
  that repository-wide counts require authoritative verification.
- Verification: launch-context Git fixture tests.
- Blocked by: AQ-F2-T1
- Blocks: AQ-F3-T2, AQ-F5-T1
- Context: shared launch context.

### AQ-F3-T2 - Persist context and evidence metadata

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F3
- Outcome: Reviews can audit which sources and repository snapshot shaped a run.
- Scope: Message/run metadata and UI-safe context receipt.
- Out of scope: Persisting secret file contents.
- Acceptance: Metadata records source paths/fingerprint and redacted Git scope;
  assistant prose contains no required receipt.
- Verification: provider persistence tests.
- Blocked by: AQ-F2-T2, AQ-F3-T1
- Blocks: AQ-F5-T1
- Context: agent message metadata and transports.

## AQ-F4 - Codex native-quality surface

### AQ-F4-T1 - Spike Codex App Server against ACP

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Feature AQ-F4
- Outcome: One evidence-backed keep/migrate decision covers thread lifecycle,
  permissions, tools, models, context, telemetry, cancellation, and recovery.
- Scope: Local probe and automated fixture adapter where feasible.
- Out of scope: Removing ACP before the gate passes.
- Acceptance: Decision records every required capability and a rollback path.
- Verification: probe tests plus same-model comparison.
- Blocked by: AQ-F2-T1
- Blocks: AQ-F4-T2
- Context: current Codex ACP provider and installed Codex runtime.

### AQ-F4-T2 - Apply the gated Codex transport decision

- [ ] Completion: acceptance and verification passed
- Status: selected ACP/App Server path implemented; focused tests and a live
  Codex smoke pass. Native same-model score comparison remains.
- Parent: Project Flapstack / Feature AQ-F4
- Outcome: Codex runs on the best verified surface with ACP rollback retained
  until migration proves stable.
- Scope: Implement migration if AQ-F4-T1 passes; otherwise retain ACP and apply
  the shared context/evidence adapter.
- Out of scope: Unproven production replacement.
- Acceptance: Codex passes session, tool, permission, telemetry, and benchmark
  gates on the selected path.
- Verification: Codex focused tests and live same-model smoke.
- Blocked by: AQ-F4-T1
- Blocks: AQ-F5-T1
- Context: Codex router/provider integration.

## AQ-F5 - Quality gate and closeout

### AQ-F5-T1 - Add permanent multi-provider quality fixtures

- [ ] Completion: acceptance and verification passed
- Status: permanent five-provider fixture, full check, and live
  Codex/Cursor/OpenRouter/NanoGPT smokes pass. Claude live smoke is blocked by
  the saved OAuth token returning 401; native-baseline rescoring remains.
- Parent: Project Flapstack / Feature AQ-F5
- Outcome: Automated fixtures catch stale-main answers, session bleed, duplicate
  prose, envelope echo, and tool evidence loss.
- Scope: Multi-worktree fixture, provider adapter fixtures, hard-fact assertions,
  and token/context budgets.
- Out of scope: Automatically grading hidden reasoning.
- Acceptance: All supported providers pass hard correctness and persistence
  checks; Codex/Claude same-model runs are within two points of native baselines.
- Verification: focused quality suite plus `npm run check`.
- Blocked by: AQ-F1-T1, AQ-F1-T2, AQ-F2-T2, AQ-F2-T3, AQ-F3-T1, AQ-F3-T2, AQ-F4-T2
- Blocks: change closeout
- Context: provider fixtures and benchmark evidence.
