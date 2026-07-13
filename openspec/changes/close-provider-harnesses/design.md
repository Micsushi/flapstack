## Context

Cursor runs through `cursor-agent`; OpenRouter and NanoGPT run through a
Flapstack-managed OpenCode sidecar. They share chat/run persistence, provider
identity, permissions, usage, and reasoning UI, but differ in auth, model
catalog, session protocol, tool approval, and package resolution.

## Goals / Non-Goals

- Goals: current capability discovery, safe credential flow, one-run/one-turn
  semantics, durable terminal state, honest permission limits, exact model
  identity, cancellation, and provider-live evidence.
- Non-goals: force protocol parity, invent unsupported image/tool/reasoning
  features, require expensive models, or replace OpenCode in this feature.

## Decisions

- Probe and record current Cursor/OpenCode/provider versions before live rows;
  stale static assumptions become fixtures only after revalidation.
- Normalize provider events at harness boundaries, while retaining sanitized
  provider-native event and limitation metadata for diagnosis.
- Keep credentials out of renderer reads, argv, generated config, and logs;
  pass them only through approved main-process/environment boundaries.
- A blocked prompt remains attached to one user turn. Successful auth recovery
  regenerates that turn without adding a duplicate user bubble or run.
- Catalog choices persist exact provider-native model IDs. Defaults must be
  currently listed and chat-capable; capability failure blocks the default.
- Production permission claims come from S3-F12 and production MCP
  approval/audit paths. Dev-test-control MCP may launch and inspect tests but
  cannot replace those product safety controls.
- Bind live evidence to exact CLI/sidecar/provider versions, SHA, profile,
  chat/run IDs, sanitized logs, and persisted database rows.

## Verification Strategy

1. Contract and fixture tests cover parsing, timeout, event ordering, auth,
   model filtering, permissions, failures, cancellation, and persistence.
2. Dev-test-control MCP performs real provider launch/wait/cancel/inspection
   where supported without fabricating provider results.
3. Verified dev UI checks prove chat creation, stream, retry, approval, stop,
   continuation, reload, chips, and exact models.
4. Package probes prove sidecar/CLI resolution from a production-like PATH.
5. Node 22 full gate and strict OpenSpec close the feature.

## Risks / Trade-offs

- CLIs and catalogs drift. Capability probes and typed unsupported/error states
  are safer than silently accepting changed output.
- Live calls cost money and credentials may be unavailable. Use low-value keys
  and low-cost models; blocked rows remain explicit.

## Rollback

Preserve existing chats/runs and selected model IDs. A bad new default may be
removed from defaults without deleting user-added models or historical runs.
