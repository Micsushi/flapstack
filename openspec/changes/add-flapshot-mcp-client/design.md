## Context

Flapshot is separately installed GPL software. Flapstack must remain an ordinary MCP
client. Media is too large for inline tool responses and must cross the boundary as an
authorized, integrity-checked file reference.

## Goals / Non-Goals

- Goals: public stdio MCP only, capability-gated UI, durable lifecycle evidence, bounded
  attachment ingestion, provenance and tamper detection.
- Non-goals: private APIs, linked/shared runtime, shared database, packaging Flapshot,
  cloud transport, OCR, transcription, or non-macOS capture support.

## Decisions

- Reuse the existing MCP configuration surface and reserve server name `flapshot`.
- Use the official MCP SDK and validate discovery below the renderer boundary.
- Pin protocol parsing to Flapshot lifecycle checkpoint `c0c120b`.
- Require explicit six-digit pairing for each live stdio connection before enabling actions.
- Use only public bounded screenshot and recording target descriptors.
- Persist operation correlation separately from attachments; link them only after terminal
  success and integrity validation.
- Copy bounded media into existing attachment storage. Keep large video file-backed.
- Treat disconnect, missing files, tamper, denial, unsupported capabilities, timeout, and
  cancellation as visible terminal/degraded outcomes.

## Risks / Trade-offs

- Pairing and approvals intentionally die on disconnect. Reconnect must expose a new code
  instead of pretending authority persisted.
- Local path grants are authenticated and may expire. Revalidate on ingestion and expose
  revoked/missing state instead of caching success.
- Copying video duplicates disk use. The 128 MiB copy threshold bounds duplication while
  larger files retain verified references.

## Migration Plan

1. Add nullable provenance/integrity fields to existing attachments.
2. Add a local operation correlation table.
3. Existing attachments remain unchanged and valid.
4. Removal can drop the client/UI while leaving attachment files readable.
