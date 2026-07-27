# Completion Tiers

Flapstack uses three separate completion states.

## Tier 1 — Code Complete

Use `implemented` when the required code, UI, data changes, configuration, docs,
and focused automated tests exist and no known missing implementation blocks the
stated outcome.

Tier 1 means the work is ready for independent acceptance. It does not close the
authoritative task checkbox.

## Tier 2 — AI Accepted

Use `complete — AI accepted` after an independent agent:

- reviews the implementation against its scope and acceptance criteria;
- runs all relevant style, lint, type, unit, integration, end-to-end, build,
  package, and CI-equivalent gates;
- exercises the real app, product MCP, test-control MCP, provider, package, or
  operating-system path when the behavior depends on it;
- checks persistence, restart, cancellation, failure, security, migration, and
  recovery behavior where applicable;
- confirms the exact source SHA, build, and data profile under test; and
- finds no known P0/P1 or acceptance-blocking defect.

Agent-written tests alone are not enough when the real product path can be
exercised. Real MCP interaction counts when it drives the production behavior
and verifies observable or persisted results. Fixtures may prepare isolated
state but do not prove acceptance by themselves.

Automated semantic/accessibility checks may satisfy Tier 2 when they exercise
the real component or renderer contract for accessible names, roles, states,
focus order, keyboard operation, errors, and dynamic announcements. An owner's
keyboard, screen-reader, or visual-satisfaction walkthrough remains Tier 3
unless it is explicitly labeled `release-blocking`.

At Tier 2:

- the authoritative OpenSpec task checkbox may be checked;
- a feature is complete when all required tasks and integrated acceptance pass;
- a stage is `implementation complete` when all required features and the
  integrated agent gate pass.

## Evidence Classes

Every active acceptance row must state one class so implementation status is
not confused with environment or release certification:

- `T2-core`: required for task, feature, and stage implementation completion.
- `T2-capability:<name>`: certifies an optional provider, platform, device, or
  hardware capability. It blocks only the matching capability claim.
- `release-gate`: certifies a distributable artifact or release environment,
  such as production signing, approved malware scanning, hosted CI retention,
  or clean-VM install/upgrade/uninstall. It blocks `release ready`, not
  `implementation complete`.
- `tracking-only`: informational and never a completion gate.

Agent-verifiable work does not become Tier 3 merely because its environment is
missing. If an available, authorized environment can exercise a capability, the
agent must use it. Otherwise the capability or release row remains explicitly
uncertified while its underlying core contracts may still reach Tier 2.

Split a task or matrix row that mixes core implementation with capability,
release, or owner evidence before closing its core checkbox. Never reclassify a
failing core check simply to make a stage appear complete.

Only `T2-core` acceptance closes an implementation task or feature checkbox.
Capability and release rows stay visible in the stage matrix with independent
counts; they never enter a combined “percent complete” denominator.

## Tier 3 — Owner Manual Tested

Tier 3 records the owner's personal testing and satisfaction. Its states are:

- not tested;
- passed;
- issue found;
- retest required;
- accepted with limitation.

Tier 3 is tracked in
[`owner-manual-testing-backlog.md`](owner-manual-testing-backlog.md). It does not
hold implementation checkboxes open unless a check is explicitly labeled
`release-blocking`.

An owner-discovered P0/P1 or claimed-requirement failure reopens Tier 2.
Non-blocking feedback becomes follow-up work without invalidating the evidence
that previously passed.

## Status Vocabulary

- `code complete`: all required work reached Tier 1.
- `implementation complete`: all required work reached Tier 2.
- `owner tested`: selected or all Tier 3 checks passed.
- `release ready`: Tier 2 plus every explicitly release-blocking owner,
  packaging, security, deployment, and release-decision gate.

Do not use `fully done` without naming which state applies.

## Authority

- OpenSpec `tasks.md` files own task checkboxes and Tier 2 task status.
- Stage test matrices own integrated Tier 2 evidence rows.
- The owner manual-testing backlog owns Tier 3 status only.
- Historical boards remain historical. Do not bulk-check old work solely
  because this definition changed; reconcile it against existing evidence.
