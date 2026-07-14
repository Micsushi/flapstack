## ADDED Requirements

### Requirement: Exact Stage 3 Release Candidate

The release process MUST identify one immutable Stage 3 candidate SHA and prove
that every result came from the intended checkout, executable, profile, data
store, and provider/tool version.

#### Scenario: Live development is tested

- **WHEN** a live-dev row begins
- **THEN** Flapstack is started with `npm run dev`
- **AND** `npm run dev:verify` identifies the Stage 3 checkout and
  `Flapstack Dev` profile
- **AND** a generic or production `Flapstack` target cannot satisfy the row

#### Scenario: Packaged preview is tested on macOS

- **WHEN** a macOS packaged row begins
- **THEN** the package is built/launched through `npm run package:preview:mac`
- **AND** executable, bundle/protocol, `Flapstack Preview` profile, resources,
  database, and candidate SHA are recorded

#### Scenario: Candidate changes after evidence

- **WHEN** code, tests, specs, or release documentation affecting a passed row
  changes
- **THEN** the candidate SHA advances
- **AND** affected rows and the full release gate rerun before release

### Requirement: Integrated Automated Gate

The Stage 3 candidate MUST pass repository, migration, security, concurrency,
MCP, daemon, provider, reasoning, Voice, and package automation without hidden
skips or weakened controls.

#### Scenario: Existing database upgrades

- **WHEN** a representative pre-Stage-3 database is upgraded through every new
  migration
- **THEN** existing project/chat/run/settings/usage data remains readable
- **AND** new MCP, approval, audit, permission, credential, and feature state has
  safe defaults
- **AND** rollback/recovery limitations are recorded

#### Scenario: Full gate runs

- **WHEN** automated candidate validation begins
- **THEN** Node 22 `npm run check`, strict validation for every active OpenSpec
  change, focused security/concurrency suites, MCP smoke, daemon smoke, and
  package inspection pass
- **AND** every skipped or environment-gated test is enumerated and routed to a
  manual or conditional row

### Requirement: Integrated Manual Regression

The Stage 3 candidate MUST pass one isolated manual ledger covering all visible
feature boundaries and their cross-feature failure and restart behavior.

#### Scenario: Safe-control workflow is exercised

- **WHEN** production MCP exposure, approval, denial, timeout, session grant,
  audit, cross-agent spawn, self-reference denial, stop, and restart rows run
- **THEN** UI, MCP response, SQLite audit, run state, and lineage agree
- **AND** background requests do not steal focus
- **AND** secrets and private reasoning stay redacted

#### Scenario: Provider and Settings workflow is exercised

- **WHEN** Voice, secure credentials, permission modes, provider harnesses,
  Usage, reasoning, copy/search, and visible Settings rows run
- **THEN** the displayed setting matches runtime behavior and durable state
- **AND** restart, missing dependency, auth recovery, failure, and cleanup states
  remain honest

#### Scenario: Required environment is unavailable

- **WHEN** a required OS, credential, provider, package, or native resource
  cannot be tested
- **THEN** the row is BLOCKED with exact missing authority or environment
- **AND** fixtures, a different provider, or another SHA cannot replace it

### Requirement: Bounded Independent Review and Repair

The Stage 3 candidate MUST receive independent code/spec/security/reliability
review after integration, and every accepted required finding MUST be fixed and
reverified before release.

#### Scenario: Review finds a defect

- **WHEN** an independent review reports an actionable correctness, security,
  data-loss, permission, concurrency, packaging, test, or spec defect
- **THEN** the finding is assigned a stable severity and disposition
- **AND** an accepted finding is fixed on the Stage 3 branch
- **AND** focused evidence and the full release gate rerun on the new SHA

#### Scenario: Three planned review rounds finish

- **WHEN** up to three complete review/fix rounds have run
- **THEN** release may proceed only if no required finding remains unresolved
- **AND** any remaining required finding blocks release with an explicit record
- **AND** the round cap cannot convert an unresolved defect into acceptance

### Requirement: Truthful Documentation and Archival

The release process MUST keep proposals, specs, tasks, routers, manual evidence,
limitations, and archive state consistent with the final candidate.

#### Scenario: Documentation conflicts with behavior

- **WHEN** implementation or evidence differs from a requirement, task, router,
  or user-facing test instruction
- **THEN** the authoritative artifact is corrected before completion
- **AND** no checkbox is marked complete without its acceptance and verification

#### Scenario: Stage 3 becomes archive-ready

- **WHEN** S3-F17 is marked complete
- **THEN** all prerequisite feature exits and required integrated rows pass on
  the final SHA
- **AND** all active changes strict-validate and completed changes are archived
  according to OpenSpec rules
- **AND** the release handoff states exact SHA, evidence, known limitations,
  cleanup, and that squash-merge to `main` remains the user's action
