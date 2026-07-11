## Context

Flapstack already contains an app-control registry/gate scaffold and inherited UI
for consuming third-party MCP servers. Stage 3 is different: Flapstack exposes
its own local tools. The S3-F1 reconciliation decides which scaffold survives.

## Goals / Non-Goals

- Goals: local MCP transport; stable tool contracts; default-off exposure;
  caller-aware permissions; explicit approvals; redacted audit; safe spawning.
- Non-goals: hosted relay, unrestricted automation, swarm orchestration, or a
  redesign of third-party MCP client configuration.

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
- Store session grants in memory only and audit their use.
- Persist redacted summaries, never credentials, tokens, or hidden reasoning.
- Cross-agent spawning stores parent and initiator lineage and blocks loops.

## Risks / Trade-offs

- A local server expands attack surface. Bind locally, authenticate callers,
  default off, validate all input, and stop with the app.
- Mutations can invalidate the caller's context. Enforce a self-reference matrix
  before execution.
- File and run tools can escape intended scope. Resolve durable worktree and
  permission context before approval and again before execution.

## Migration Plan

Add an MCP audit migration and any per-chat exposure field with a safe default
of disabled. Verify upgrades from a Stage 2 database and rollback by disabling
registration and preserving readable audit records.

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
