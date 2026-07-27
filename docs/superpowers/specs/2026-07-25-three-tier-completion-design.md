# Three-Tier Completion Design

## Purpose

Agent-implemented work needs separate status for implementation, agent
verification, and owner manual testing. A feature can be considered implemented
and complete after independent AI acceptance without pretending the owner has
personally tested it.

This policy is the global default for all projects. Repository documentation
remains self-contained and must not depend on private external policy content.

## Completion Tiers

### Tier 1 — Code Complete

The required implementation exists, focused tests pass, and no known missing
code blocks the stated task outcome.

Tier 1 means `implemented`. It does not authorize a completion checkbox.

### Tier 2 — AI Accepted

An AI agent independently reviews the implementation and runs verification
proportional to the work:

- full relevant automated gates;
- static and security review;
- real application, service, browser, MCP, package, or runtime interaction when
  the behavior depends on it;
- persistence, restart, failure, and recovery checks where applicable;
- confirmation that no known P0/P1 or acceptance-blocking defect remains.

Tier 2 is the default definition of task and feature completion for
agent-implemented work. At Tier 2, the authoritative completion checkbox may be
checked and the item may be described as `complete — AI accepted`.

### Tier 3 — Owner Manual Tested

The owner personally follows a documented test and records pass, issue,
retest-required, or accepted-with-limitation.

Tier 3 is tracked in a separate owner manual-testing backlog. It does not block
Tier 2 completion unless the project or owner explicitly labels a manual check
`release-blocking`.

An owner-discovered P0/P1 or claimed-requirement failure reopens Tier 2.
Non-blocking feedback becomes normal follow-up work.

## Hierarchy and Authority

- Repo OpenSpec `tasks.md` remains the sole task completion board when OpenSpec
  is used.
- A task checkbox means Tier 2 passed, not that owner manual testing passed.
- A feature is complete when required tasks and feature-level Tier 2 acceptance
  pass.
- A stage is implementation-complete when required features and the integrated
  Tier 2 stage gate pass.
- Owner-tested and release-ready are separate stage states.
- The vault may summarize feature/stage status but must not duplicate repo task
  checkboxes.

## Owner Manual-Testing Backlog

Each project keeps a self-contained manual backlog in its repository when
manual testing exists. The default hierarchy is:

```md
- [ ] S4-F1 — Feature name
  - Feature test: concise end-to-end walkthrough and expected result.
  - Prerequisites: account, platform, device, data, or setup.
  - [ ] S4-F1-T1 — Task name
    - Test instructions: detailed user actions.
    - Expected: observable pass condition.
    - Notes:
  - [ ] S4-F1-T2 — Task name
    - Test instructions: detailed user actions.
    - Expected: observable pass condition.
    - Notes:
```

Rules:

- Tasks are nested beneath their owning feature.
- The feature instruction is concise and tests the integrated workflow.
- A task gets a separate manual entry only when it has meaningful
  user-observable, hardware, provider, packaged, or OS behavior.
- Instructions include prerequisites, actions, expected result, and notes.
- Manual state is one of: not tested, passed, issue found, retest required, or
  accepted with limitation.
- Release-blocking manual checks are explicitly labeled; no unlabeled Tier 3
  item blocks Tier 2 completion.

## Existing Project Migration

- Do not rewrite historical evidence documents.
- Active task boards are reconciled against Tier 2 evidence before boxes change.
- Existing manual matrices become owner backlogs or clearly identify which rows
  are Tier 2 versus release-blocking Tier 3.
- No checkbox is bulk-checked merely because the semantic rule changed.

## Flapstack Adoption

- Stage 4 and Stage 5 use Tier 2 for task/feature implementation completion.
- Owner manual tests move to a separate hierarchical backlog.
- Existing automated, MCP, live-app, package, and review evidence is reused.
- Stage status is recalculated as code completion, AI acceptance, and owner
  manual testing instead of one restrictive percentage.
