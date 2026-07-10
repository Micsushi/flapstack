# Stage 2 Tasks

Full per-task detail (files, scope, done-when, blockers) lives in the vault board
`Wiki/Projects/flapstack/stage2-implementation-tasks.md`. This checklist mirrors
it for OpenSpec tracking.

## 0. Prerequisite

- [ ] 0.1 F2: native-module ABI toggle removal so `npm run check` runs cleanly
- [x] 0.2 D0: verify `cursor-agent` CLI flags, stream-json schema, and thinking fixture

## 1. Voice (Track A)

- [ ] 1.1 V1 Speech adapter interfaces + settings (fill scaffold)
- [ ] 1.2 V2 STT: whisper.cpp `base` local + cloud hardening
- [ ] 1.3 V3 TTS: system voice (macOS)
- [ ] 1.4 V4 TTS: system voice (Windows)
- [ ] 1.5 V5 TTS: offline Kokoro engine
- [ ] 1.6 V6 Spoken/Displayed pipeline (harness skill + extract + non-LLM fallback)
- [ ] 1.7 V7 Voice UX: mic capture + read-aloud controls
- [ ] 1.8 V8 Voice settings tab
- [ ] 1.9 V9 OS mic permissions + honest failure states
- [ ] 1.10 V-exit voice tests + manual matrix

## 2. Usage (Track B)

- [ ] 2.1 U1 Shared usage schema + provider adapter interface
- [ ] 2.2 U2 Shared usage engine + scheduler
- [ ] 2.3 U3 Background usage daemon lifecycle
- [ ] 2.4 U4 Shared SQLite store + app/daemon locking
- [ ] 2.5 U5 App startup catch-up + manual refresh
- [ ] 2.6 U6 Codex + Anthropic/Claude general usage providers
- [ ] 2.7 U7 Cursor usage provider (source 1 full; sources 2/3 stubbed chain)
- [ ] 2.8 U8 OpenRouter usage provider (run usage, generation/cost reconcile,
      key credits/limits where available, estimate fallback)
- [ ] 2.9 U9 NanoGPT usage provider (run usage/cost where available; pricing
      estimate fallback; account-wide history only if current API exposes it)
- [ ] 2.10 U10 Threshold alerts + Discord webhook notifications from daemon
- [ ] 2.11 U11 Usage dashboard + settings + daemon status
- [ ] 2.12 U-exit usage tests + manual matrix

## 3. Cursor harness (Track D)

- [x] 3.0 D0 Verify `cursor-agent` CLI surface + reasoning fixture
- [x] 3.1 D1 Harness contract extension (`cursor-agent`, teal chip)
- [x] 3.2 D2 `cursor-agent` stream-json child-process adapter, including
      `type:"thinking"` event normalization into the shared Thinking UI when
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
- [x] 4.4 E4 Session/event bridge + Thinking normalization
- [x] 4.5 E5 Permission mapping + approval bridge
- [x] 4.6 E6 Run persistence, checkpoints, manifests, and usage hooks
- [x] 4.7 E7 Provider onboarding, model catalog, chips, and settings
- [x] 4.8 E8 Native harness spike + defer/continue decision
- [ ] 4.9 E-exit OpenCode-backed harness tests + manual matrix

## 5. Thinking Display Parity (Cross-track)

- [ ] 5.1 T0 Provider behavior matrix + fixture capture
- [ ] 5.2 T1 Shared thinking stream contract + persistence rules
- [ ] 5.3 T2 Incremental Thinking UI stream behavior
- [ ] 5.4 T3 Claude thinking stream/backfill verification
- [ ] 5.5 T4 Codex/OpenAI/ACP reasoning handling
- [ ] 5.6 T5 Cursor thinking stream integration
- [ ] 5.7 T6 OpenRouter/NanoGPT/local-model reasoning adapter contract
- [ ] 5.8 T7 Thinking fixtures, tests, and manual matrix

## 6. Fixes (Track C)

- [ ] 6.1 F1 Strict-TS debt cleanup → promote `ts:check` to gate
- [ ] 6.2 F3 Create-branch dialog
- [ ] 6.3 F4 Terminal actions (open file / tab title / focused pane)
- [ ] 6.4 F5 Sidebar remote-stats decision
- [ ] 6.5 F6 Codex/Claude permission enforcement hardening
- [ ] 6.6 F7 Worktree UX completion: custom path + unknown state
- [ ] 6.7 F8 Scoped-search result navigation + no hidden first-20 cap
- [ ] 6.8 F9 Attachments/artifacts UX completion + no hidden first-six cap
- [ ] 6.9 F10 Run history show-all/pagination
- [ ] 6.10 F11 Cross-scope move discoverability
- [ ] 6.11 F12 Docs consistency pass
- [ ] 6.12 F-exit fixes verified in `npm run check`

(F2 native-module ABI toggle is task 0.1 — the prerequisite done first.)

## 7. Stage exit

- [ ] 7.1 `npm run check` green (lint, style, tests, build)
- [ ] 7.2 OpenSpec change validated and archived
- [ ] 7.3 Handoff + `feature-todo.md` Stage 2 boxes updated with known limitations
