## Context

Stage 2 is a large, cross-cutting slice touching the main process (speech, usage,
harness adapters), the renderer (voice UX, usage dashboard, Cursor identity), the
DB schema (usage tables), and external dependencies. Decisions were closed in the
S2.0 grill-me gate (2026-07-09). Reuse comes from two reference repos:
`agent-hotline` (speech filter + TTS engines) and `onWatch` (usage math + a
complete Cursor usage client).

## Goals / Non-Goals

- Goals: local-first voice I/O; usage tracking for Anthropic/Codex/Cursor; a
  `cursor-agent` coding harness; keep every failure state honest.
- Non-Goals: wake word / continuous conversation; premium cloud TTS or voice
  cloning; the full Cursor usage admin-API and CLI sources (stubbed this stage);
  Cursor editor automation or an ACP bridge; streaming Spoken/Displayed (final
  replies only).

## Decisions

- **STT**: whisper.cpp `base` multilingual, downloaded on first use into app data;
  cloud Whisper secondary. Small installer, honest download state.
- **TTS**: offline Kokoro default, OS system voice fallback.
- **Spoken source**: harness-authored `Spoken:`/`Displayed:` via a Flapstack
  read-aloud skill, extracted by the ported filter; non-LLM fallback only when no
  `Spoken:` section is present. No per-reply summarization call. Rationale: the
  harness authors the spoken text upstream, so extraction adds no latency/cost.
- **Usage pollers**: main-process interval scheduler, default 5-min, configurable.
- **Usage dashboard**: new top-level tab (onWatch is dashboard-shaped).
- **Cursor usage**: three-source fallback chain; ship source 1 (internal endpoints
  `cursor.com/api/*`, token auto-detected from Cursor's local state SQLite
  `cursorAuth/accessToken`); sources 2 (admin API) and 3 (CLI) are stubbed slots.
- **Cursor harness**: stream-json child-process adapter modeled on `claude.ts`
  (NOT ACP); teal chip; permission mapping degrades honestly like Codex.
- **Sequencing**: fix native-module ABI (F2) first; Track D past D1 waits on D0
  (install + verify `cursor-agent`).

## Risks / Trade-offs

- Cursor usage source 1 uses undocumented endpoints → store raw payloads, tag the
  source, degrade through the chain on drift.
- `cursor-agent` CLI surface may differ from assumptions → D0 verifies the live
  flags + event schema before the adapter is built.
- Native-module ABI mismatch blocks the test gate → F2 first.
- Stage scope is large; Track D (greenfield + external CLI) is the first defer
  candidate if schedule pressure appears.

## Migration Plan

- Add `usage_samples` / `usage_cycles` tables via a Drizzle migration; verify on a
  seeded DB copy that existing Stage 1 data survives and new tables are queryable.
- Adding `cursor-agent` to the harness union is additive; existing Codex/Claude
  runs are unaffected.

## Open Questions

- Exact `cursor-agent` stream-json event schema and permission/approval flags —
  resolved by D0 against the installed CLI, not assumed here.
