## Context

Flapstack already contains an app-control registry/gate scaffold and inherited UI
for consuming third-party MCP servers. Stage 3 is different: Flapstack exposes
its own local tools. The S3-F1 reconciliation decides which scaffold survives.

## Goals / Non-Goals

- Goals: local MCP transport; stable tool contracts; default-off exposure;
  caller-aware permissions; explicit approvals; redacted audit; safe spawning.
- Non-goals: hosted relay, unrestricted automation, swarm orchestration, a
  redesign of third-party MCP client configuration, or reuse of the
  development-only HTTP test-control MCP as a product transport.

## Decisions

- Maintain one registry as the source for tool metadata and execution routing.
- Use one stdio child per enabled caller. The harness owns the child lifecycle;
  EOF, disconnect, app shutdown, SIGINT, or SIGTERM closes it. No port is opened.
- The main process writes caller identity into the child environment from the
  selected chat/run. Tool input can never select or override caller identity.
- Keep one registry for metadata and dispatch. tRPC may report management state
  but is not an alternate execution transport.
- Default every chat's Flapstack MCP exposure to off.
- Attribute calls to a chat/run identity token, not an untrusted argument.
- Tier 0 reads may run under read-only access. Tier 1 and Tier 2 follow the
  caller's permission mode. Tier 3 always requires explicit approval.
- Provider permission and product app-control permission are separate gates.
  Read-only may call only registry-classified Tier 0 product tools; it does not
  authorize arbitrary third-party MCP. Ask mode produces one Flapstack decision
  for a product call, not a provider prompt followed by a second product prompt.
  Tier 3 always keeps the Stage 3 approval even when the provider would allow it.
- Store session grants in memory only and audit their use.
- Persist redacted summaries, never credentials, tokens, or hidden reasoning.
- Cross-agent spawning stores parent and initiator lineage and blocks loops.
- Child-process mutations publish a main-process invalidation event after commit;
  the renderer refetches affected chat, run, audit, and approval queries instead
  of waiting for a manual refresh.

## Risks / Trade-offs

- A local server expands attack surface. Bind locally, authenticate callers,
  default off, validate all input, and stop with the app.
- Mutations can invalidate the caller's context. Enforce a self-reference matrix
  before execution.
- File and run tools can escape intended scope. Resolve durable worktree and
  permission context before approval and again before execution.

## Migration Plan

The rebased migration chain owns exposure, approval, audit, and custom-capability
storage in one post-Stage-2 migration. A migration fixture must build a real
Stage 2 schema, apply the current chain, and prove safe defaults and append-only
audit behavior. Rollback disables registration while preserving readable audit
records.

Startup recovery runs after database initialization and migrations. It
reclassifies only interrupted MCP-origin runs, identified by an MCP-owned
`prompt_message_id`, from `running` to `pending`; all other interrupted runs
become `cancelled`. The queue drain launches only MCP-origin pending rows. This
ordering prevents migration-time table errors and prevents ordinary abandoned
runs from being relaunched as MCP work.

## Transport decision

The initial transport is stdio, tested by spawning the real child entry through
the MCP SDK client. It has no listening socket, naturally isolates concurrent
chat connections, and lets Codex and Claude use their existing MCP launch model.
An authenticated loopback server would require port discovery, token rotation,
cross-chat multiplexing, and stale-session cleanup without improving the first
local-only release.

Startup is idempotent per harness configuration: each connection creates one
fresh child and registry instance. Disconnect or app shutdown closes all owned
children. A stale child has only its immutable launch snapshot; later gate work
revalidates durable chat/run state before any mutation. Self-reference is
evaluated against that trusted snapshot. Discovery exposes only implemented
tools, so gated or unfinished mutations cannot be invoked early.

## MCP surface separation

- Product app control: per-chat, default-off stdio child; launcher-owned caller
  identity; product permission tiers, approval, audit, and self-reference rules.
- Development test control: verified-development-only authenticated loopback
  HTTP server; ephemeral descriptor/token; diagnostics and test-run control.
- Third-party MCP clients: existing provider configuration consumed by agent
  harnesses. Their tools are never assumed to be product Tier 0 merely because
  they use MCP.

No descriptor, bearer token, loopback endpoint, registry entry, or permission
decision crosses these surfaces.
