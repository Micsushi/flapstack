# app-control-mcp Specification

## Purpose

TBD - created by archiving change add-stage3-mcp-control. Update Purpose after archive.

## Requirements

### Requirement: Local MCP exposure

Flapstack SHALL expose one local MCP control surface by default to supported
chats, allow per-chat disablement, and stop it cleanly with the application.

#### Scenario: User-disabled chat

- **WHEN** Flapstack MCP exposure is disabled for a chat
- **THEN** that chat cannot discover or call Flapstack app-control tools
- **AND** only child runs and sessions launched with that product-MCP exposure
  are revoked; ordinary provider runs remain active
- **AND** durable exposure state and live child identity agree before the
  disable operation reports success

#### Scenario: Supported chat defaults to enabled

- **WHEN** a new supported chat is created
- **THEN** its harness can list and call tools through authenticated local transport
- **AND** the user can disable exposure for that chat

#### Scenario: Existing chat is upgraded

- **WHEN** an existing chat is upgraded to this release
- **THEN** its persisted exposure choice is preserved
- **AND** an existing opt-out is not silently re-enabled

#### Scenario: Third-party server uses the reserved product name

- **WHEN** one or more user-managed third-party MCP entries use any
  case-insensitive spelling of the reserved `flapstack` name
- **THEN** product classification requires trusted launcher registration,
  origin, and caller identity rather than the display name
- **AND** every collision receives a distinct non-product alias without being
  silently deleted or gaining product privileges

#### Scenario: Development test control is present

- **WHEN** the development-only HTTP test-control MCP is enabled
- **THEN** it remains a separate authenticated test surface and does not expose,
  register, or bypass the product app-control stdio server

### Requirement: Structured operations

The server SHALL provide validated, stable operations for inspecting and
controlling supported Flapstack objects without returning raw database rows.

#### Scenario: Read app state

- **WHEN** an authorized caller lists projects, tasks, chats, runs, or worktrees
- **THEN** it receives compact identifiers, names, status, and scope breadcrumbs

#### Scenario: Invalid mutation input

- **WHEN** a caller submits malformed, stale, or out-of-scope input
- **THEN** the operation fails with a structured error and changes nothing

#### Scenario: File access targets a rooted object

- **WHEN** a renderer or product MCP caller reads, recursively lists, watches,
  writes, renames, moves, or trashes a file-backed object
- **THEN** it uses an explicit relative target beneath a registered project or
  worktree root, or an absolute attachment/plan path proven to belong to the
  durable chat record that requested it
- **AND** registration binds the lexical path to a canonical real path and,
  where supported, device/inode identity before use
- **AND** traversal, arbitrary absolute targets, symlink/reparse escapes, and
  observed root/parent/final replacement fail before the operation dispatches
- **AND** no portable continuous-race or cross-platform `openat`/`renameat`
  guarantee is implied

#### Scenario: External mutation refreshes the live UI

- **WHEN** a product MCP child commits a chat, run, approval, or audit mutation
- **THEN** the main process invalidates the affected renderer queries and the
  visible UI refetches without a manual refresh

### Requirement: Permission and approval gate

Every MCP call MUST resolve trusted caller identity and pass the risk gate before
execution. Full-access callers SHALL auto-approve product MCP operations;
Tier 3 operations in every other writable mode MUST receive explicit user approval.

#### Scenario: Dangerous action

- **WHEN** a caller outside full-access mode requests a Tier 3 action
- **THEN** Flapstack waits for explicit approval and denies on rejection or timeout

#### Scenario: Full-access auto-approval

- **WHEN** a full-access caller requests any implemented product MCP action
- **THEN** Flapstack dispatches it without a provider or product approval prompt
- **AND** trusted identity, scope, capability, self-reference, and durable audit gates still apply

#### Scenario: Custom caller capabilities

- **WHEN** a caller uses custom permission mode
- **THEN** Flapstack loads its exact per-chat capability toggles from durable
  storage for every call and fails closed when that state is missing, malformed,
  stale, or unsupported

#### Scenario: Read-only product MCP call

- **WHEN** a read-only caller invokes a registry-classified Tier 0 product tool
- **THEN** it is allowed without treating arbitrary third-party MCP tools as
  read-only

#### Scenario: Ask mode does not double prompt

- **WHEN** an ask-before-edits caller invokes a Tier 1 or Tier 2 product tool
- **THEN** Flapstack presents one correlated product approval decision rather
  than stacking a provider prompt and a second app-control prompt

#### Scenario: Provider allows a guarded Tier 3 call

- **WHEN** the provider-native gate would allow a Tier 3 product tool outside full-access mode
- **THEN** the Stage 3 app-control approval remains mandatory and cannot be
  skipped by the provider decision

#### Scenario: Background approval

- **WHEN** a background chat needs approval
- **THEN** Flapstack signals the pending decision without stealing application focus

#### Scenario: Mandatory pre-dispatch audit is unavailable

- **WHEN** the required pre-dispatch audit record cannot be durably stored for
  any Tier 0 through Tier 3 call
- **THEN** the call fails closed with zero handler dispatch or mutation

### Requirement: Auditable actions

Flapstack SHALL persist a redacted audit record for every allowed, denied,
approval-required, failed, and completed MCP call.

#### Scenario: Secret-bearing input

- **WHEN** an MCP input or result contains credential-like data
- **THEN** arbitrary strings are omitted or irreversibly hashed by default
- **AND** only operation-specific safe fields are stored in clear text
- **AND** the audit record contains no recoverable secret, including a secret
  embedded in a path, URL, environment assignment, or provider identifier

#### Scenario: Terminal audit append fails after dispatch

- **WHEN** a handler has executed but its completed or failed terminal audit
  record cannot be durably appended
- **THEN** durable invocation state records that execution occurred and that
  terminal reconciliation is required
- **AND** startup/runtime recovery exposes a durable retry-safe, unknown,
  reconciled, or exhausted state without redispatching the handler
- **AND** an exact non-idempotent unknown outcome remains blocked while a
  different input fingerprint is not poisoned by that claim
- **AND** retry-safe work requires an explicit bounded retry authorization and
  cannot consume more than one recovery retry

### Requirement: Safe cross-agent spawning

Flapstack SHALL allow approved supported callers to create a thread for another
harness while preserving parent and initiator lineage and exposing it in the UI.

#### Scenario: Any supported provider spawns another provider

- **WHEN** a Codex, Claude, Cursor, OpenRouter, or NanoGPT caller receives approval
  to create and launch a thread for a different supported provider
- **THEN** Flapstack creates it with resolved model, scope, permissions, worktree, and lineage

#### Scenario: Spawned chat is visible as a fork

- **WHEN** a spawned chat is displayed anywhere the user can select a chat
- **THEN** it shows an accessible fork symbol and its parent identity
- **AND** parent-to-child and child-to-parent links navigate both directions

#### Scenario: Recursive spawn attempt

- **WHEN** a spawn would violate self-reference or loop rules
- **THEN** Flapstack denies it and records the reason

### Requirement: Agent task orchestration membership

Flapstack SHALL organize an orchestration request into one durable user-visible
task containing the initiating chat and all spawned worker chats.

#### Scenario: Create a named orchestration task

- **WHEN** the user starts an orchestration such as `Finish Stage 4` without an
  existing task
- **THEN** Flapstack creates one task with that name and attaches the initiating
  chat and every descendant worker chat

#### Scenario: Attach orchestration to an existing task

- **WHEN** an authorized UI or product MCP caller supplies an eligible task
- **THEN** Flapstack attaches the orchestration and all descendant chats to that
  task without creating a duplicate task

#### Scenario: Shared create-or-attach contract

- **WHEN** the UI or product MCP creates an orchestration
- **THEN** both surfaces use the same validated create-or-attach DTO and service
- **AND** required approvals, audit records, and renderer invalidation remain
  consistent across both surfaces

### Requirement: Configurable heterogeneous workers

Flapstack SHALL persist provider-neutral worker definitions that may use
different supported harnesses, providers, models, and execution strategies in
one orchestration.

#### Scenario: Define a worker

- **WHEN** the user or an authorized caller adds a worker
- **THEN** the definition may specify role/name, prompt/spec, harness/provider,
  model, reasoning effort, permissions, worktree/branch strategy, dependencies,
  and completion criteria

#### Scenario: Mix worker types

- **WHEN** one task includes workers with different supported definitions
- **THEN** each worker launches with its own resolved immutable execution
  snapshot while sharing task budgets, queue state, and lineage

### Requirement: Durable bounded scheduler

Flapstack SHALL use a durable scheduler to enforce per-task parallelism,
dependencies, pause state, and exactly one launch claim per worker attempt.

#### Scenario: Parallel limit reached

- **WHEN** a task has reached its configured maximum parallel subagents
- **THEN** additional ready workers remain queued until a slot is durably released

#### Scenario: Concurrent scheduler drains

- **WHEN** multiple scheduler drains race for the same task or worker
- **THEN** transactional claims prevent exceeding the task limit or launching a
  worker attempt twice

#### Scenario: Dependency is incomplete

- **WHEN** a queued worker depends on incomplete or failed work
- **THEN** it does not launch and reports the blocking dependency

#### Scenario: Application restarts

- **WHEN** Flapstack restarts with queued, active, paused, budgeted, or stopped
  orchestration state
- **THEN** task membership, queue position, budgets, lineage, attempts, and stop
  state are reconstructed without duplicating completed work

### Requirement: Enforceable orchestration stop conditions

Flapstack SHALL enforce durable completion/progress, wall-clock, token/cost,
failure/blocker, and manual stop conditions before every launch and after every
worker state or usage update.

#### Scenario: Completion or progress target is reached

- **WHEN** the configured completion criteria or progress target is satisfied
- **THEN** no additional worker launches and the task records the matching stop reason

#### Scenario: Time or usage ceiling is reached

- **WHEN** elapsed wall-clock time, authoritative tokens/cost, or configured
  honest fallback token/time limits reach the task ceiling
- **THEN** the scheduler stops new launches and records the measured source and
  stop reason

#### Scenario: Exact cost is unavailable

- **WHEN** a provider does not report authoritative cost
- **THEN** Flapstack labels displayed cost as estimated, never presents it as exact,
  and enforces configured token and time ceilings rather than invented cost

#### Scenario: Failure or blocker threshold is reached

- **WHEN** failed or blocked worker attempts reach the configured threshold
- **THEN** the task stops according to policy and preserves each failure result

#### Scenario: Manual stop

- **WHEN** an authorized user manually stops a task
- **THEN** queued launches are cancelled, active attempts receive the supported
  stop action, lineage remains queryable, and the manual stop is audited

### Requirement: Orchestration status and controls

The task UI SHALL show aggregate orchestration state and provide safe lifecycle
controls without rewriting history or duplicating completed work.

#### Scenario: Review orchestration status

- **WHEN** the user opens an orchestration task
- **THEN** the UI shows aggregate progress; active, queued, completed, failed,
  and stopped workers; usage and cost provenance; dependencies; lineage;
  results; and the current stop reason

#### Scenario: Pause and resume

- **WHEN** an authorized user pauses and later resumes an orchestration
- **THEN** no new work launches while paused and only eligible queued work
  resumes afterward

#### Scenario: Retry or replace a worker

- **WHEN** an authorized user retries or replaces a failed or stopped worker
- **THEN** Flapstack creates a linked attempt or replacement, preserves immutable
  lineage and results, and does not rerun completed dependencies

#### Scenario: Add a worker

- **WHEN** an authorized user adds a worker to a running or paused orchestration
- **THEN** the worker joins the durable queue with validated dependencies and is
  subject to the existing limits, stop conditions, permissions, and audit rules

#### Scenario: Unsafe orchestration mutation

- **WHEN** a mutation contains a loop, excessive depth, duplicate ancestor,
  stale identity, invalid permission/worktree scope, or unauditable action
- **THEN** Flapstack fails closed without changing queue, budget, or lineage state

### Requirement: Startup recovery after migrations

Flapstack SHALL run interrupted-run reconciliation only after the current
database migration chain succeeds and SHALL relaunch only pending MCP-origin
runs.

#### Scenario: Interrupted MCP run

- **WHEN** startup finds a `running` run whose prompt message is MCP-owned
- **THEN** it becomes `pending` and is eligible for the MCP recovery drain

#### Scenario: Interrupted ordinary run

- **WHEN** startup finds any other `running` run
- **THEN** it becomes `cancelled` and is not relaunched by the MCP recovery drain

### Requirement: User-visible management and safety

The user SHALL be able to inspect MCP exposure, connection state, pending
approvals, audit history, and actionable safety failures.

#### Scenario: Review audit history

- **WHEN** the user filters MCP history by caller, tool, or decision
- **THEN** matching redacted records are displayed without hidden execution
