## Context

Stage 2 is a large, cross-cutting slice touching the main process (speech, usage,
harness adapters), the renderer (voice UX, usage dashboard, Cursor/OpenRouter/
NanoGPT identity), the DB schema (usage tables), and external dependencies.
Decisions were closed in the S2.0 grill-me gate (2026-07-09). Reuse comes from
four reference repos: `agent-hotline` (speech filter + TTS engines), `onWatch`
(usage math + a complete Cursor usage client), OpenCode (harness engine), and
Vibe Kanban (OpenCode sidecar adapter pattern). Aider is cloned for
reference-only harness research. OpenRouter and NanoGPT are added through an
OpenCode-backed harness path in the same Stage 2 harness-adapter push.

## Goals / Non-Goals

- Goals: local-first voice I/O; replace `onWatch` with background-capable usage
  tracking for Anthropic/Claude, Codex/OpenAI, Cursor, OpenRouter, and NanoGPT;
  a `cursor-agent` coding harness; OpenRouter and NanoGPT OpenCode-backed
  harnesses; keep every failure state honest.
- Non-Goals: wake word / continuous conversation; premium cloud TTS or voice
  cloning; the full Cursor usage admin-API and CLI sources (stubbed this stage);
  Cursor editor automation or an ACP bridge; OpenRouter OAuth/app-key minting;
  vendoring OpenCode internals as the first implementation path; NanoGPT
  accountless x402 payment flow; image/video generation through NanoGPT;
  streaming Spoken/Displayed (final replies only).

## Decisions

- **STT**: whisper.cpp `base` multilingual, downloaded on first use into app data.
  Cloud STT is deferred; dictation remains local-only. Small installer, honest download state.
- **TTS**: offline Kokoro default, OS system voice fallback.
- **Spoken source**: harness-authored `Spoken:`/`Displayed:` via a Flapstack
  read-aloud skill, extracted by the ported filter; non-LLM fallback only when no
  `Spoken:` section is present. No per-reply summarization call. Rationale: the
  harness authors the spoken text upstream, so extraction adds no latency/cost.
- **Usage engine**: shared TypeScript engine with no renderer dependency. It can
  run inside the Flapstack main process or inside a small background daemon.
- **Usage daemon**: Stage 2 adds a local background process so provider polling
  and Discord webhook alerts continue when Flapstack is closed. Mac-first is
  acceptable for the first implementation; Windows/Linux service hooks are
  designed but may be completed after the Mac path if needed.
- **Usage pollers**: shared interval scheduler, default 5-min, configurable per
  provider. The daemon is the preferred scheduler; the app main process can run
  the same engine for manual refresh, startup reconcile, or fallback.
- **Usage dashboard**: new top-level tab (onWatch is dashboard-shaped). The UI
  reads SQLite-first, then runs startup catch-up/manual refresh.
- **Usage store**: one shared local SQLite store for daemon writes and app reads,
  with duplicate prevention, raw payload preservation, provider/account tags,
  cost-quality labels, and honest provider state.
- **Startup catch-up**: on app launch, reconcile provider data since the latest
  sample where APIs support history. If a provider only exposes current
  aggregate/run-level data, label unrecoverable gaps honestly.
- **Discord alerts**: daemon sends Discord webhook alerts while the app is
  closed. Store webhook URLs as credentials and never log them.
- **Cursor usage**: three-source fallback chain; ship source 1 (internal endpoints
  `cursor.com/api/*`, token auto-detected from Cursor's local state SQLite
  `cursorAuth/accessToken`); sources 2 (admin API) and 3 (CLI) are stubbed slots.
- **Cursor harness**: stream-json child-process adapter modeled on `claude.ts`
  (NOT ACP); teal chip; permission mapping degrades honestly like Codex.
- **Codex/OpenAI usage**: track general account usage where current OpenAI usage
  and cost APIs plus credentials allow it, not only Flapstack runs. Preserve
  onWatch Codex profile/account behavior where still useful.
- **Claude/Anthropic usage**: track general workspace/account usage through the
  Anthropic Admin Usage and Cost APIs where credentials allow it. If only Claude
  Code/local credential data is available, label capability limits honestly.
- **Harness-engine decision**: OpenCode sidecar first. OpenCode already has an
  agent session runner, model/tool continuation, OpenRouter provider support,
  generic OpenAI-compatible provider support for NanoGPT, permission rules, and
  server/session/permission APIs. Vibe Kanban's OpenCode executor is the adapter
  blueprint. Aider is not the primary harness; use it only as reference for
  repo-map/context, edit formats, shell-confirm UX, git commits, and OpenRouter
  model metadata.
- **OpenRouter harness**: Flapstack launches a local OpenCode sidecar with
  isolated generated config for OpenRouter: `https://openrouter.ai/api/v1`,
  bearer key from Flapstack's encrypted credential path, optional app
  attribution headers, model list/catalog cache, purple chip, and usage hooks.
- **NanoGPT harness**: Flapstack launches the same OpenCode sidecar path with
  OpenCode's OpenAI-compatible provider config for NanoGPT:
  `https://nano-gpt.com/api/v1` by default, bearer key from Flapstack's
  encrypted credential path, normal chat-completions first, model list/catalog
  cache, rose chip, and usage hooks.
- **OpenCode sidecar control**: Flapstack owns sidecar launch, per-run auth,
  config generation, event normalization, approval bridge, cancellation, run
  persistence, checkpoints, manifests, and UI identity. OpenCode owns the local
  model/tool continuation loop.
- **Permission bridge**: Flapstack maps resolved permission modes into OpenCode
  agent permission rules and approval replies. If OpenCode cannot enforce a
  Flapstack toggle exactly, surface a `HarnessPermissionLimitation` instead of
  pretending it was enforced.
- **Reasoning output**: stream provider-visible reasoning output when Flapstack
  owns the run; use saved JSONL/session files only for import/backfill/debug.
  Claude visible reasoning output maps from `thinking_delta`/`thinking` blocks; Codex
  renders ACP thought chunks or OpenAI reasoning summaries when exposed, but
  encrypted reasoning content is opaque and not displayable; Cursor currently
  emits `type:"thinking"` stream-json deltas in the installed CLI despite docs
  saying reasoning output is suppressed in print mode, so the adapter must render those
  events when present and tolerate their absence; OpenRouter normalizes
  `reasoning`, visible `reasoning_details` text/summary, and usage reasoning-
  token counts; NanoGPT normalizes `delta.reasoning` plus legacy
  `delta.reasoning_content`. If a provider streams reasoning-output deltas, Flapstack
  shows them incrementally as they arrive instead of waiting to append one final
  block at turn end.
- **Direct API reasoning controls**: Stage 2 uses provider/model defaults for
  OpenRouter and NanoGPT reasoning parameters. Do not expose effort/max-token
  controls until model capability detection is reliable enough to avoid sending
  unsupported request fields.
- **Reasoning token counts**: show reasoning-token usage where it falls out
  naturally from provider usage metadata; otherwise keep it as usage/run metadata
  and defer richer live token-count UI.
- **OpenRouter usage/cost**: capture usage from Flapstack-owned runs, store
  generation IDs, reconcile generation stats/cost where OpenRouter supports it,
  and poll key credits/limits where available. Do not claim full account-wide
  history unless current API coverage proves it.
- **NanoGPT usage/cost**: capture usage/cost from Flapstack-owned runs when
  returned and estimate from model pricing metadata otherwise. Verify current
  NanoGPT account-wide history/balance API coverage during implementation; if
  absent, label NanoGPT as run-usage only plus estimates.
- **Saved reasoning-output history**: Stage 2 may use saved JSONL/session files for
  import, debug, or backfill plumbing. Do not add a primary user-facing saved
  history viewer as part of the reasoning-output work.
- **Sequencing**: fix native-module ABI (F2) first; Track D past D1 waits on D0
  (install + verify `cursor-agent`).

## Risks / Trade-offs

- Background daemon/service management adds OS-specific risk → build Mac-first,
  keep the usage engine shared, and make daemon health visible in the app.
- Shared app/daemon SQLite access can double-count or lock → use transaction
  boundaries, source/sample ids, retry logic, and duplicate keys.
- Discord webhooks are secrets → encrypt at rest, never log, validate host, and
  persist send failures without exposing the URL.
- Startup catch-up quality varies by provider → label exact historical data,
  current aggregate data, run-only data, and estimates separately.
- Cursor usage source 1 uses undocumented endpoints → store raw payloads, tag the
  source, degrade through the chain on drift.
- `cursor-agent` CLI surface may differ from assumptions → D0 verifies the live
  flags + event schema before the adapter is built. Current live output includes
  `type:"thinking"` events while Cursor docs say reasoning output is suppressed in print
  mode, so fixtures must cover both present and absent reasoning-output streams.
- Reasoning visibility differs by provider → render only provider-visible
  reasoning output, summaries, thought chunks, and token counts; preserve encrypted or
  provider-private reasoning only as opaque metadata for continuity/debug.
- OpenCode sidecar adds process/config/version management risk → pin or resolve
  a reproducible OpenCode package, isolate generated config, kill process groups
  on cancel/end, redact logs, and test startup/cancel failure states.
- OpenRouter/NanoGPT are API providers, not coding CLIs → OpenCode handles the
  model/tool loop for Stage 2, but Flapstack still owns sidecar control and
  permission mapping. If sidecar limits product control, record that in E8 and
  plan a later native harness.
- Model catalogs and pricing change frequently → cache with refresh, store raw
  provider payloads, and keep pricing estimates visibly approximate when exact
  provider cost is not returned.
- Native-module ABI mismatch blocks the test gate → F2 first.
- Stage scope is large; Track D/E provider work is the first defer candidate if
  schedule pressure appears.

## Migration Plan

- Add `usage_samples` / `usage_cycles` tables via a Drizzle migration; verify on a
  seeded DB copy that existing Stage 1 data survives and new tables are queryable.
- Adding `cursor-agent`, `openrouter`, `nanogpt`, and the internal
  `opencode-sidecar` adapter contract is additive; existing Codex/Claude runs
  are unaffected.

## Open Questions

- Exact long-term stability of Cursor `thinking` stream-json events, because live
  CLI behavior and current docs disagree. D2 should be fixture-driven and
  compatibility-guarded.
- Exact OpenCode version to pin for Stage 2. E2 must choose a reproducible
  package/binary strategy before implementation depends on event shape.
