# Stage 2 Tasks

This checklist is the repo-local OpenSpec record for task scope, completion, and
blockers. Machine-local `STAGE2-*.md` planning notes kept outside this
repository carry implementation detail by track.

## 0. Prerequisite

- [x] 0.1 F2: native-module ABI toggle removal so `npm run check` runs cleanly
- [x] 0.2 D0: verify `cursor-agent` CLI flags, stream-json schema, and reasoning-output fixture

## 1. Voice (Track A)

- [x] 1.1 V1 Speech adapter interfaces + settings (fill scaffold)
- [x] 1.2 V2 STT: bundled whisper.cpp batch local, selectable pinned models,
      renderer PCM WAV conversion, and cloud hardening
- [x] 1.3 V3 TTS: system voice (macOS)
- [x] 1.4 V4 TTS: system voice (Windows)
- [x] 1.5 V5 TTS: offline Kokoro engine
- [x] 1.6 V6 model-independent read-aloud (no harness skill/prompt injection;
      legacy Spoken extraction + non-LLM fallback)
- [x] 1.7 V7 Voice UX: mic capture + manual message speech controls
- [x] 1.8 V8 Voice settings tab
- [x] 1.9 V9 OS mic permissions + honest failure states
- [x] 1.10 V10 inline seek, global speed, reading cursor, and per-provider voices
- [x] 1.11a V11 application-owned caveman full + ponytail full defaults across harnesses
- [x] 1.11b V12 remove read-aloud prompt injection and verify reply-format independence
- [x] 1.11c V13 optional machine-local vault context across all harnesses
- [x] 1.11d V14 remove composer/global automatic read-aloud controls and playback
- [ ] 1.11 V-exit voice tests + manual matrix

## 2. Usage (Track B)

- [x] 2.1 U1 Shared usage schema + provider adapter interface
- [x] 2.2 U2 Shared usage engine + scheduler
- [x] 2.3 U3 Background usage daemon lifecycle
- [x] 2.4 U4 Shared SQLite store + app/daemon locking
- [x] 2.5 U5 App startup catch-up + manual refresh
- [x] 2.6 U6 Codex + Anthropic/Claude general and personal quota providers
- [x] 2.7 U7 Cursor usage provider (source 1 full; sources 2/3 stubbed chain)
- [x] 2.8 U8 OpenRouter usage provider (run usage, generation/cost reconcile,
      key credits/limits where available, estimate fallback)
- [x] 2.9 U9 NanoGPT usage provider (run usage/cost where available; pricing
      estimate fallback; account-wide history only if current API exposes it)
- [x] 2.10 U10 Threshold alerts + Discord webhook notifications from daemon
- [x] 2.11 U11 Usage dashboard + historical charts + settings + daemon status
- [ ] 2.12 U-exit usage tests + manual matrix

## 3. Cursor harness (Track D)

- [x] 3.0 D0 Verify `cursor-agent` CLI surface + reasoning fixture
- [x] 3.1 D1 Harness contract extension (`cursor-agent`, teal chip)
- [x] 3.2 D2 `cursor-agent` stream-json child-process adapter, including
      provider `type:"thinking"` event normalization into the shared Reasoning output UI when
      present
- [x] 3.3 D3 Onboarding + login/token detect
- [x] 3.4 D4 Permission mapping + honest limitations
- [x] 3.5 D5 Chips, model catalog, UI wiring
- [ ] 3.6 D-exit cursor harness tests + manual matrix

## 4. OpenRouter and NanoGPT OpenCode-backed Harnesses (Track E)

- [x] 4.0 E0 Harness-engine source decision + local repo inventory
      (OpenCode sidecar first; Vibe Kanban adapter blueprint; Aider reference-only)
- [x] 4.1 E1 OpenCode sidecar harness contract (`openrouter`, `nanogpt`,
      `opencode-sidecar`, limitation states)
- [x] 4.2 E2 OpenCode sidecar launcher + authenticated HTTP/event client
- [x] 4.3 E3 Generated isolated OpenCode config for OpenRouter and NanoGPT
- [x] 4.4 E4 Session/event bridge + Reasoning-output normalization
- [x] 4.5 E5 Permission mapping + approval bridge
- [x] 4.6 E6 Run persistence, checkpoints, manifests, and usage hooks
- [x] 4.7 E7 Provider onboarding, model catalog, chips, and settings
- [x] 4.8 E8 Native harness spike + defer/continue decision
- [ ] 4.9 E-exit OpenCode-backed harness tests + manual matrix
- [x] 4.10 Limit normal provider selectors to DeepSeek/GLM defaults with persistent Add model choices
- [x] 4.10a Use provider-only identity chips with compact icons and limit Cursor
      selectors to Composer 2.5/Auto defaults with opt-in extra models
- [ ] 4.11 Replace stale NanoGPT DeepSeek defaults and live-test a chat-capable model

## 5. Reasoning Output Parity (Cross-track)

- [x] 5.1 T0 Provider behavior matrix + fixture capture
- [x] 5.2 T1 Shared reasoning-output stream contract + persistence rules
- [x] 5.3 T2 Incremental Reasoning output UI stream behavior
- [x] 5.3a T2a Codex-style live/completed reasoning timer and click disclosure
- [x] 5.4 T3 Claude reasoning-output stream/backfill verification
- [x] 5.5 T4 Codex/OpenAI/ACP reasoning handling
- [x] 5.6 T5 Cursor reasoning-output stream integration
- [x] 5.7 T6 OpenRouter/NanoGPT/local-model reasoning adapter contract
- [ ] 5.8 T7 Reasoning-output fixtures, tests, and manual matrix

## 6. Fixes (Track C)

- [x] 6.1 F1 Strict-TS debt cleanup → promote `ts:check` to gate
- [x] 6.2 F3 Create-branch dialog
- [x] 6.3 F4 Terminal actions (open file / tab title / focused pane)
- [x] 6.4 F5 Sidebar remote-stats decision (summary-only until opened locally)
- [x] 6.5 F6 Codex/Claude permission enforcement hardening + pre-run limitations
- [x] 6.6 F7 Worktree UX completion: custom path + unknown state
- [x] 6.7 F8 Scoped-search result navigation + no hidden first-20 cap
- [x] 6.8 F9 Attachments/artifacts UX completion + no hidden first-six cap
- [x] 6.9 F10 Run history show-all/pagination
- [x] 6.10 F11 Cross-scope move discoverability
- [x] 6.11 F12 Docs consistency pass
- [x] 6.12 F-exit fixes verified in `npm run check`

(F2 native-module ABI toggle is task 0.1 - the prerequisite done first.)

## 7. Stage exit

- [x] 7.1 `npm run check` green (lint, style, strict types, tests, build)
- [ ] 7.2 OpenSpec change validated and archived
- [x] 7.3 Handoff + `feature-todo.md` Stage 2 boxes updated with known limitations
