# Change: Prove reasoning parity

## Why

Shared reasoning output, timers, persistence, provider adapters, and fixtures
exist, but former Stage 2 tasks `5.8` and `5.8h` remain open. Stage 3 must prove
that each provider displays only provider-visible reasoning, preserves honest
token/private/fallback states, survives reload and search, and never upgrades a
fixture into false live evidence.

## What Changes

- Promote former Stage 2 `5.8` and `5.8h` into S3-F16 tasks.
- Freeze one provider/capability matrix for visible deltas, final summaries,
  token-only output, opaque/private metadata, tools, plans, timers, effort, and
  unsupported fallbacks.
- Strengthen normalization, dedupe, persistence, reload, search, remount, and
  accessibility coverage.
- Capture real Claude, Codex, Cursor, OpenRouter, and NanoGPT UI evidence after
  provider harness closeout.
- Publish exact provider versions, request capability, observed events, saved
  message parts, and UI result without fabricating chain-of-thought.

## Impact

- Affected specs: new `reasoning-parity-evidence` capability.
- Affected code: shared reasoning contract/normalizers, provider transports,
  duration state, message persistence/search, reasoning UI, tests, fixtures,
  dev test-control inspection, and evidence docs.
- Dependencies: S3-F15 provider harness closeout for live Cursor/OpenRouter/
  NanoGPT runs, S3-F10 credentials for live providers, and dev-test-control MCP
  closeout for authoritative headless state where supported.

## Migration of Existing Task Authority

- Former Stage 2 `5.8 T7 Reasoning-output fixtures, tests, and manual matrix`
  maps to S3-F16-T1 through S3-F16-T5.
- Former Stage 2 `5.8h T7h capability/fallback tests plus live provider
evidence` maps to S3-F16-T2, T3, T4, and T5.
- S3-F16 `tasks.md` is the sole completion authority for these open rows.
