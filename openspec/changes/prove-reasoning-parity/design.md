## Context

Providers expose different reasoning shapes: streamed visible text, final
summaries, thought chunks, legacy fields, token counts, encrypted details, or no
reasoning. The shared UI must normalize observable behavior without presenting
private model state as readable reasoning.

## Goals / Non-Goals

- Goals: deterministic normalization, no duplication, honest capability and
  fallback state, durable timers/content, reload/search parity, and provider-live
  evidence for every required path.
- Non-goals: recover hidden chain-of-thought, require every provider to expose
  readable reasoning, or infer visible content from reasoning token counts.

## Decisions

- Preserve a typed distinction between visible text/summary, token-only counts,
  opaque encrypted/private metadata, and absent/unsupported reasoning.
- Deduplicate stream/final data by provider event identity and normalized
  content progression, not by hiding arbitrary repeated prose.
- Persist only displayable reasoning and sanitized opaque/count metadata needed
  for continuity, usage, or diagnosis.
- Derive live/completed duration from authoritative run/message timestamps so
  remount and restart do not reset or fabricate time.
- Provider/model capability determines whether on/off/effort fields are sent.
  Unsupported controls resolve through an explicit fallback and limitation.
- Treat fixture, recorded capture, CLI-live, provider-live, UI-live, and reload
  evidence as separate levels.
- Use real provider output only for behavior evidence; do not quote or expose
  private reasoning or secrets in artifacts.

## Verification Strategy

1. Shared fixtures cover visible, summary, cumulative, final-only, token-only,
   opaque/private, absent, malformed, and duplicate event shapes.
2. UI integration tests cover progressive disclosure, duration, completion,
   remount/reload, search, accessibility, tools/plans, and hidden metadata.
3. Provider-live runs record request capability, sanitized event shape, persisted
   parts, and final UI for Claude, Codex, Cursor, OpenRouter, and NanoGPT.
4. Node 22 full gate and strict OpenSpec close only after matrix reconciliation.

## Risks / Trade-offs

- Provider output can vary by account/model. Record exact model/version and
  accept an honest no-visible-reasoning result when the protocol supports it.
- Over-aggressive dedupe can erase valid repeated text. Dedupe only known
  stream/final replay of the same provider part.

## Rollback

Keep historical message parts readable. Any schema evolution must support old
visible reasoning and safely ignore unknown opaque metadata.
