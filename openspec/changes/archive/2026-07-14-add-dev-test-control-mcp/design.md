## Context

The main process owns live provider streams, pending approvals, the SQLite
connection, and the exact development profile. An external SQLite-only stdio
server cannot safely control those in-memory resources. UI automation can, but
it is slow and cannot reliably distinguish renderer state from provider state.

## Goals / Non-Goals

- Goals: exact dev-profile inspection; real provider run launch; approval and
  cancellation control; bounded waiting; redacted diagnostics; no UI clicks.
- Non-goals: packaged exposure, user-facing app control, cross-agent spawning,
  production permission policy, or a general replacement for Stage 3 MCP.

## Decisions

- Run one MCP Streamable HTTP server inside Electron main on `127.0.0.1` with
  an ephemeral port.
- Start only when `IS_DEV` and the verified dev checkout guard has passed.
- Generate an in-memory bearer token per app start and write a mode-0600 local
  descriptor containing URL, token, PID, checkout, and profile.
- Reuse one dev-control registry for MCP discovery and dispatch.
- Return compact DTOs and redacted log tails; never return provider keys,
  credential files, raw environment variables, or hidden reasoning metadata.
- Launch OpenRouter and NanoGPT through the real sidecar/persistence path first;
  report unsupported harnesses explicitly until their routers expose reusable
  run services.
- Keep mutations narrow: create or archive dev test chats, launch test runs,
  reply to pending provider approvals, and cancel runs. No project/chat deletion
  or file writes.

## Risks / Trade-offs

- Loopback is still a local attack surface. Bearer authentication, dev-only
  startup, ephemeral ports, input validation, and clean shutdown bound it.
- A descriptor contains a live control token. Store it only under the dev
  profile with owner-only permissions and remove it on clean shutdown.
- Initial launch support is OpenCode-backed providers. The tool reports the
  supported harness list rather than pretending Codex, Claude, or Cursor can be
  driven through the same service.

## Migration Plan

No database migration. Delete the descriptor and stop the server to roll back.
Packaged builds never start or publish the server.

## Open Questions

None. The user approved the dev-only scope and explicitly excluded the larger
production Stage 3 MCP implementation.
