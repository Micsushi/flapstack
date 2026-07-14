## Context

Flapstack supports multiple agent harnesses with different session and prompt
surfaces. A single raw user-message envelope is simple but repeatedly spends
tokens, duplicates provider-native instructions, and gives every provider the
same stale view of a multi-worktree repository.

## Goals / Non-Goals

### Goals

- Make repository-wide answers evidence-first across every provider.
- Keep distinct Flapstack chats isolated at the provider session layer.
- Reduce repeated context without losing durable project instructions.
- Preserve exact, auditable provider text, reasoning summaries, tools, and
  usage without duplicate visible output.
- Allow Codex and Claude to approach or exceed their native harness results in
  a controlled same-model benchmark.

### Non-Goals

- Cloud memory, embeddings, or cross-user synchronization.
- Treating remembered facts as current repository truth.
- Fabricating hidden chain-of-thought.
- Migrating Codex away from ACP before a bounded App Server spike passes.
- Automatically mutating Git state during preflight.

## Decisions

### Structured context bundle

Launch context is divided into behavior, selected files, live repository
scope, evidence rules, and UI-only receipt metadata. Full selected context is
sent on a fresh provider session. Resumed turns receive a compact contract plus
request-relevant live evidence. Providers may map these sections to their
native system/developer/user surfaces, but visible behavior is shared.

### Live evidence outranks handoff and memory

Handoffs and remembered project facts are retrieval leads. When a prompt asks
about project status, completion, remaining work, stages, branches, or
worktrees, Flapstack creates a read-only Git snapshot. If multiple worktrees
exist, the model must inspect the applicable worktree and authoritative task
source before making a repository-wide count.

### Provider-owned sessions stay chat-owned

A fresh Flapstack chat starts a fresh provider session. Resume is allowed only
with the session identifier stored for that same chat. Missing-session recovery
starts new instead of continuing an unrelated latest session.

### Canonical persistence boundary

Each adapter normalizes cumulative text and provider tool payloads before the
assistant message is stored. Exact envelope echoes, repeated full-answer
blocks, and anonymous tool placeholders are regression failures.

### Codex transport migration is gated

Codex App Server is evaluated against ACP for thread lifecycle, cancellation,
permissions, model selection, tools, skills, MCP, context injection, telemetry,
and recovery. ACP remains the production path until the spike and fixture suite
prove a safe migration.

### Codex transport spike result

Retain the pinned `@agentclientprotocol/codex-acp` 1.1.2 adapter. Its installed
implementation already starts `codex app-server`; Flapstack's
`@mcpc-tech/acp-ai-provider` boundary maps those App Server operations into the
AI SDK stream. Replacing it with another direct JSON-RPC adapter would duplicate
the same protocol translation without a verified quality gain.

| Capability                      | Installed ACP/App Server evidence                             | Decision                  |
| ------------------------------- | ------------------------------------------------------------- | ------------------------- |
| Thread lifecycle                | `thread/start` and `thread/resume`                            | Keep                      |
| Turn lifecycle and cancellation | `turn/start` and `turn/interrupt`                             | Keep                      |
| Permissions and sandbox         | ACP modes map approval and sandbox configuration              | Keep                      |
| Tools and edits                 | App Server events map to canonical ACP tool calls             | Keep                      |
| Models and reasoning            | `model/list` plus model/reasoning configuration               | Keep                      |
| Skills and MCP                  | `skills/list`, MCP startup, calls, approvals, and status      | Keep                      |
| Context                         | Flapstack supplies the new structured bundle as the user turn | Improve in shared adapter |
| Telemetry and recovery          | Session IDs, usage polling, resume, and cleanup remain wired  | Keep and test             |

The selected production label is `codex-acp/app-server`. Rollback stays at the
existing ACP boundary: shared context/metadata can be removed independently,
and no database migration is required. A future direct adapter must beat this
path on the same session, tool, permission, telemetry, cancellation, recovery,
and same-model quality fixtures before replacement.

## Risks / Trade-offs

- Request classification can miss unusual wording. The classifier is
  conservative and a multi-worktree warning is cheap enough to include when
  uncertain.
- Fresh-session detection differs by provider. Each adapter must report whether
  a session was created or resumed; silent fallback must not omit required
  context.
- Aggressive text deduplication can remove intentional repetition. Only exact
  cumulative prefixes and exact repeated full blocks are removed.
- Git preflight adds latency. It uses bounded read-only commands and runs only
  for repository-sensitive prompts or when the repository has multiple
  worktrees.

## Migration Plan

1. Fix provider session isolation and transcript fidelity.
2. Introduce the structured context/preflight API behind current adapters.
3. Adopt it in every provider without changing stored user messages.
4. Add fixtures and compare existing behavior before changing Codex transport.
5. Migrate Codex only after the App Server gate passes; otherwise keep ACP.

Rollback is file-level: adapters can return to the previous prompt builder and
ACP path without a database rollback because new metadata is additive.
