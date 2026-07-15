## Context

Stage 4 already owns attachments, artifacts, workspaces, knowledge, permissions,
and provider context. Visual capture must compose with those systems.

## Goals / Non-Goals

- Goals: deliberate capture, clear preview, redaction, provenance, safe agent use,
  platform parity, retention, and optional standalone entry.
- Non-goals: continuous surveillance, hidden background capture, webcam, OCR
  secrets extraction, unrestricted remote desktop, or silent screenshots.

## Decisions

- Every capture requires visible user initiation or a scoped approval.
- Sources are display, window, application window, and region where OS allows.
- Preview occurs before attachment/context use; redaction is destructive in the exported derivative.
- Original retention is opt-in and separate; default stores only confirmed result.
- Records include source class, dimensions, timestamps, project/task/chat/run,
  redactions, hashes, and actor without app/window title secrets by default.
- Agent capture tool is separate from browser/shell and requires exact scope.
- Standalone helper is extracted only after in-app acceptance and calls the same local service.

## Migration Plan

Add visual artifact metadata additively. Existing image attachments remain valid
without fabricated provenance.
